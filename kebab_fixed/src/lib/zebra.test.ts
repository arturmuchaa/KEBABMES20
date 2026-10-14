// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  discoverZebraDevices, getDevices, sendThenReadZpl, sendZpl, sendZplJobs,
  ZEBRA_TIMEOUT_MS, type ZebraDevice,
} from './zebra'
import { calibrateZebra } from './zebraPrinter'
import { loadedZebraMedia, rememberZebraMedia, selectZebra, zebraMediaTestZpl, zebraProfileForZpl } from './zebraProfiles'
import { parsePrinterIdentity, parsePrinterStatus, printerProblems } from '@/features/raw-batches/printerStatus'

const status = (length = 639) => `\x02030,0,0,${length},000,0,0,0,000,0,0,0\x03\r\n`
  + '\x02001,0,0,0,0,2,4,0,00000000,1,000\x03\r\n\x021234,0\x03\r\n'
let serial = 0
function printer(): ZebraDevice {
  const uid = `usb-${++serial}`
  rememberZebraMedia(uid, '50x80')
  return {
    uid, name: 'GC420t',
    send: vi.fn((_data, ok) => ok()),
    sendThenRead: vi.fn((data, ok) => ok(data === '~HI' ? 'GC420t,V61,8,8192' : status())),
  }
}
beforeEach(() => { localStorage.clear(); vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); delete window.BrowserPrint })

describe('wspólny transport Zebra', () => {
  it('zachowuje tekst błędu USB i nie ponawia niepewnego wydruku', async () => {
    const device = printer()
    device.send = vi.fn((_data, _ok, fail) => fail('USB write failed: device disconnected'))
    await expect(sendZpl(device, zebraMediaTestZpl('50x80'))).rejects.toThrow('USB write failed: device disconnected')
    expect(device.send).toHaveBeenCalledTimes(1)
  })

  it('po błędzie callbacka odblokowuje kolejkę dla ręcznej kolejnej próby', async () => {
    const device = printer()
    vi.mocked(device.send).mockImplementationOnce((_data, _ok, fail) => fail({ responseText: 'busy' }))
    await expect(sendZpl(device, '~TA000')).rejects.toThrow('busy')
    await expect(sendZpl(device, '~TA001')).resolves.toBeUndefined()
  })

  it('serializuje zapis i odczyt nawet przez różne obiekty tego samego USB', async () => {
    const device = printer()
    let finish!: () => void
    device.send = vi.fn((_data, ok) => { finish = ok })
    const first = sendZpl(device, '~TA000')
    const second = sendThenReadZpl({ ...device }, '~HS')
    await vi.advanceTimersByTimeAsync(0)
    expect(device.sendThenRead).not.toHaveBeenCalled()
    finish()
    await first
    expect(await second).toBe(status())
  })

  it('timeout kończy oczekiwanie, blokuje dalszy zapis i ignoruje spóźniony sukces', async () => {
    const device = printer()
    let finish!: () => void
    device.send = vi.fn((_data, ok) => { finish = ok })
    const first = expect(sendZpl(device, '~TA000')).rejects.toThrow('Wynik operacji jest nieznany')
    const queued = expect(sendZpl(device, '~TA001')).rejects.toThrow('nadal nie odpowiedziała')
    await vi.advanceTimersByTimeAsync(ZEBRA_TIMEOUT_MS + 1)
    await first; await queued
    finish()
    expect(device.send).toHaveBeenCalledTimes(1)
  })

  it('zatrzymuje serię dokładnie przy awarii i podaje liczbę przekazanych zadań', async () => {
    const device = printer()
    vi.mocked(device.send).mockImplementationOnce((_zpl, ok) => ok())
      .mockImplementationOnce((_zpl, _ok, fail) => fail('write error'))
    const progress = vi.fn()
    const done = expect(sendZplJobs(device, ['^XA^FD1^FS^XZ', '^XA^FD2^FS^XZ', '^XA^FD3^FS^XZ'], { onProgress: progress }))
      .rejects.toThrow('Przekazano do BrowserPrint 1/3 zadań; zatrzymano na zadaniu 2')
    await vi.runAllTimersAsync(); await done
    expect(device.send).toHaveBeenCalledTimes(2)
    expect(progress.mock.calls).toEqual([[0, 3], [1, 3]])
  })

  it('nie wpuszcza kalibracji w przerwę między etykietami serii', async () => {
    const device = printer()
    const batch = sendZplJobs(device, ['^XA^FD1^FS^XZ', '^XA^FD2^FS^XZ'], { delayMs: 2000 })
    const command = sendZpl(device, '~JC')
    await vi.advanceTimersByTimeAsync(1000)
    expect(vi.mocked(device.send).mock.calls.map(c => c[0])).toEqual(['^XA^FD1^FS^XZ'])
    await vi.runAllTimersAsync(); await batch; await command
    expect(vi.mocked(device.send).mock.calls.map(c => c[0])).toEqual(['^XA^FD1^FS^XZ', '^XA^FD2^FS^XZ', '~JC'])
  })

  it.each(['', '\x02030,0,0,0639,000,0,0,0,000,0,0,0\x03'])('nie uznaje niepełnego statusu za gotowość', async raw => {
    const device = printer()
    device.sendThenRead = vi.fn((_cmd, ok) => ok(raw))
    await expect(sendZpl(device, zebraMediaTestZpl('50x80'))).rejects.toThrow('Brak pełnej odpowiedzi')
    expect(device.send).not.toHaveBeenCalled()
  })

  it('odbiera status podzielony przez USB na trzy ramki', async () => {
    const device = printer()
    const rows = status().split('\r\n')
    device.sendThenRead = vi.fn((_cmd, ok) => ok(rows[0]))
    device.read = vi.fn().mockImplementationOnce(ok => ok(rows[1])).mockImplementationOnce(ok => ok(rows[2]))
    const job = sendZpl(device, zebraMediaTestZpl('50x80'))
    await vi.runAllTimersAsync(); await job
    expect(device.send).toHaveBeenCalledTimes(1)
    expect(device.sendThenRead).toHaveBeenCalledTimes(1)
  })

  it('odmawia zapisu przy otwartej głowicy', async () => {
    const device = printer()
    device.sendThenRead = vi.fn((_cmd, ok) => ok(status().replace('001,0,0,0', '001,0,1,0')))
    await expect(sendZpl(device, zebraMediaTestZpl('50x80'))).rejects.toThrow('głowica')
    expect(device.send).not.toHaveBeenCalled()
  })

  it('respektuje wybór USB i nie przechodzi na inną drukarkę po odłączeniu', async () => {
    const chosen = printer(), other = printer()
    selectZebra(chosen.uid)
    window.BrowserPrint = {
      getDefaultDevice: (_type: string, ok: Function) => ok(other),
      getLocalDevices: (ok: Function) => ok([chosen, other]),
    }
    expect((await getDevices()).default?.uid).toBe(chosen.uid)
    window.BrowserPrint.getLocalDevices = (ok: Function) => ok([other])
    expect(await getDevices()).toEqual({ default: null, list: [] })
    expect(await discoverZebraDevices()).toEqual([other]) // panel pozwala naprawić wybór
  })

  it('nie maskuje błędu wykrywania pustą listą', async () => {
    window.BrowserPrint = {
      getDefaultDevice: (_type: string, _ok: Function, fail: Function) => fail('offline'),
      getLocalDevices: (_ok: Function, fail: Function) => fail('connection refused'),
    }
    await expect(getDevices()).rejects.toThrow('connection refused')
  })
})

describe('zmiana rolki GC420t', () => {
  it('100×150 → 50×80 → 100×150: pomiar, blokada kolejki i rozmiar testu', async () => {
    const device = printer()
    let measured = 1199
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? 'GC420t,V61,8,8192' : status(measured)))
    for (const [id, dots] of [['100x150', 1199], ['50x80', 658], ['100x150', 1217]] as const) {
      measured = dots
      const calibrating = calibrateZebra(device, id)
      let finished = false
      void calibrating.then(() => { finished = true })
      const print = sendZpl(device, zebraMediaTestZpl(id))
      await vi.advanceTimersByTimeAsync(4900)
      expect(finished).toBe(false)
      const commands = vi.mocked(device.send).mock.calls.map(c => c[0])
      expect(commands[commands.length - 1]).toBe('~JC')
      expect(commands[commands.length - 2]).toContain('^MNY^MTD^MFC,C^PW')
      expect(commands[commands.length - 2]).not.toContain('^LL')
      await vi.runAllTimersAsync()
      const result = await calibrating; await print
      expect(result.lengthMm).toBeCloseTo(dots * 25.4 / 203, 1)
      expect(loadedZebraMedia(device.uid)).toBe(id)
    }
  })

  it('nie zatwierdza starej długości po założeniu krótszej rolki', async () => {
    const device = printer()
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? '' : status(1199)))
    const result = expect(calibrateZebra(device, '50x80')).rejects.toThrow('Nie potwierdzono wyniku kalibracji')
    await vi.runAllTimersAsync(); await result
    await expect(sendZpl(device, zebraMediaTestZpl('50x80'), { autoCalibrate: false })).rejects.toThrow('Nie potwierdzono ostatniej kalibracji')
    expect(vi.mocked(device.send).mock.calls.map(c => c[0])).toEqual(['^XA^MNY^MTD^MFC,C^PW400^XZ', '~JC'])
  })

  it('nie kalibruje, jeśli w drukarce nadal są wcześniejsze zadania', async () => {
    const device = printer()
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? '' : status().replace('639,000', '639,002')))
    await expect(calibrateZebra(device, '50x80')).rejects.toThrow('zadania w buforze')
    expect(device.send).not.toHaveBeenCalled()
  })

  it('odrzuca projekt 100×150 na zapamiętanej rolce 50×80 przed wysłaniem', async () => {
    const device = printer()
    rememberZebraMedia(device.uid, '50x80')
    await expect(sendZpl(device, zebraMediaTestZpl('100x150'), { autoCalibrate: false })).rejects.toThrow('nie pasuje')
    expect(device.send).not.toHaveBeenCalled()
  })

  it('pusty lub uszkodzony status nie potwierdza zakończenia kalibracji', async () => {
    const device = printer()
    device.sendThenRead = vi.fn((_cmd, ok) => ok(''))
    const result = expect(calibrateZebra(device, '50x80')).rejects.toThrow('Nie potwierdzono')
    await vi.runAllTimersAsync(); await result
  })
})

describe('automatyczna kalibracja przy zwykłym wydruku', () => {
  it('rozpoznaje wyłącznie kompletne, jednakowe formaty termiczne o znanych wymiarach', () => {
    expect(zebraProfileForZpl(zebraMediaTestZpl('80x100'))).toBe('80x100')
    expect(zebraProfileForZpl('^XA^FDTEST^FS^XZ')).toBeNull()
    expect(zebraProfileForZpl(zebraMediaTestZpl('50x80').replace('^MTD', '^MTT'))).toBeNull()
    expect(zebraProfileForZpl(zebraMediaTestZpl('50x80') + zebraMediaTestZpl('100x150'))).toBeNull()
    expect(zebraProfileForZpl(zebraMediaTestZpl('50x80').replace('^PW400', '^PW591'))).toBeNull()
  })

  it('bez otwierania panelu: 100×150 → 50×80 → 80×100, kalibracja raz na zmianę, potem cała seria', async () => {
    const device = printer()
    let actualLength = 1217
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? 'GC420t,V61,8,8192' : status(actualLength)))
    for (const [id, length] of [['100x150', 1217], ['50x80', 658], ['80x100', 818]] as const) {
      actualLength = length
      const progress = vi.fn()
      const before = vi.mocked(device.send).mock.calls.length
      const printing = sendZplJobs(device, [zebraMediaTestZpl(id), zebraMediaTestZpl(id)], { onStatus: progress })
      await vi.advanceTimersByTimeAsync(4900)
      expect(vi.mocked(device.send).mock.calls.slice(before).some(c => c[0].includes('^FD'))).toBe(false)
      await vi.runAllTimersAsync(); await printing
      const writes = vi.mocked(device.send).mock.calls.slice(before).map(c => c[0])
      expect(writes.filter(c => c === '~JC')).toHaveLength(1)
      expect(writes.filter(c => c.includes('^FD'))).toHaveLength(2)
      expect(writes.filter(c => c.includes('^FD')).every(c => c.includes('^MFC,C'))).toBe(true)
      expect(writes.join('')).not.toMatch(/~TA|\^JUS/)
      expect(progress).toHaveBeenCalledWith(expect.stringContaining('automatyczna kalibracja'))
    }
  })

  it('pierwszy wydruk na nieznanej drukarce kalibruje i nie wymaga wyboru rolki w menu', async () => {
    const device = printer()
    localStorage.clear()
    const printing = sendZpl(device, zebraMediaTestZpl('50x80'))
    await vi.runAllTimersAsync(); await printing
    expect(loadedZebraMedia(device.uid)).toBe('50x80')
    expect(vi.mocked(device.send).mock.calls.filter(c => c[0] === '~JC')).toHaveLength(1)
  })

  it('nie kalibruje ponownie przy kolejnym wydruku tego samego formatu', async () => {
    const device = printer()
    await sendZpl(device, zebraMediaTestZpl('50x80'))
    await sendZpl(device, zebraMediaTestZpl('50x80'))
    expect(vi.mocked(device.send).mock.calls.filter(c => c[0] === '~JC')).toHaveLength(0)
    expect(vi.mocked(device.send).mock.calls.every(c => c[0].includes('^MFC,C'))).toBe(true)
  })

  it('inna zmierzona długość wyzwala pomiar mimo zgodnego starego profilu', async () => {
    const device = printer()
    let length = 1199
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? 'GC420t,V61,8,8192' : status(length)))
    device.send = vi.fn((zpl, ok) => { if (zpl === '~JC') length = 658; ok() })
    const printing = sendZpl(device, zebraMediaTestZpl('50x80'))
    await vi.runAllTimersAsync(); await printing
    expect(vi.mocked(device.send).mock.calls.filter(c => c[0] === '~JC')).toHaveLength(1)
  })

  it('nie drukuje, jeśli faktyczna rolka nadal nie pasuje; kolejny ręczny druk ponownie sprawdza po poprawieniu rolki', async () => {
    const device = printer()
    let length = 1199
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? '' : status(length)))
    const failed = expect(sendZpl(device, zebraMediaTestZpl('50x80'))).rejects.toThrow('Nie potwierdzono wyniku kalibracji')
    await vi.runAllTimersAsync(); await failed
    expect(vi.mocked(device.send).mock.calls.some(c => c[0].includes('^FD'))).toBe(false)
    length = 658
    const retry = sendZpl(device, zebraMediaTestZpl('50x80'))
    await vi.runAllTimersAsync(); await retry
    expect(vi.mocked(device.send).mock.calls.filter(c => c[0].includes('^FD'))).toHaveLength(1)
  })

  it('czeka na poprzedni wydruk przed automatyczną kalibracją', async () => {
    const device = printer()
    let buffered = true
    device.sendThenRead = vi.fn((cmd, ok) => ok(cmd === '~HI' ? '' : status(1217).replace('1217,000', buffered ? '1217,002' : '1217,000')))
    const printing = sendZpl(device, zebraMediaTestZpl('100x150'))
    await vi.advanceTimersByTimeAsync(2000)
    expect(device.send).not.toHaveBeenCalled()
    buffered = false
    await vi.runAllTimersAsync(); await printing
    expect(vi.mocked(device.send).mock.calls.filter(c => c[0] === '~JC')).toHaveLength(1)
  })
})

describe('status i rozdzielczość GC420t', () => {
  it('8 punktów/mm to 203 dpi', () => expect(parsePrinterIdentity('GC420t,V61,8,8192').dpi).toBe(203))
  it('czyta błąd kalki, głowicy i temperatury z właściwych pól', () => {
    const raw = status().replace('000,0,0,0\x03', '000,0,0,1\x03').replace('001,0,0,0', '001,0,1,1')
    const parsed = parsePrinterStatus(raw)
    expect(parsed.valid).toBe(true)
    expect(printerProblems(parsed).join(' ')).toMatch(/głowica.*kalki.*przegrzana/i)
  })
})
