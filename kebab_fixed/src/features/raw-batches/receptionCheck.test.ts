import { describe, expect, it } from 'vitest'
import {
  checkIssues, checkStatus, needsCorrectiveAction, tempExceeded,
  type ReceptionCheck,
} from './receptionCheck'

const pusty: ReceptionCheck = {
  receptionId: 'r1', visual: null, tempChamber: null, tempMeat: null,
  kgMatch: null, notes: '', verdict: null,
  ncDescription: '', ncAction: '', ncAt: null,
}
const komplet: ReceptionCheck = {
  ...pusty, visual: 'bz', tempChamber: 2.5, tempMeat: 3.1,
  kgMatch: 'bz', verdict: 'K',
}

describe('checkStatus', () => {
  it('nic nie wpisano → brak', () => {
    expect(checkStatus(pusty)).toBe('brak')
  })
  it('część pól → niepelne', () => {
    expect(checkStatus({ ...pusty, visual: 'bz' })).toBe('niepelne')
  })
  it('komplet pól → komplet', () => {
    expect(checkStatus(komplet)).toBe('komplet')
  })
  it('temperatura 0 °C liczy się jako wypełniona', () => {
    expect(checkStatus({ ...komplet, tempChamber: 0 })).toBe('komplet')
  })
})

describe('tempExceeded', () => {
  it('drób chłodzony: 4,0 °C mieści się w progu', () => {
    expect(tempExceeded(4.0, 'drob', 'chlodzony')).toBe(false)
  })
  it('drób chłodzony: 4,1 °C przekracza', () => {
    expect(tempExceeded(4.1, 'drob', 'chlodzony')).toBe(true)
  })
  it('mięso czerwone ma próg +7 °C', () => {
    expect(tempExceeded(6.5, 'czerwone', 'chlodzony')).toBe(false)
  })
  it('mrożone: −10 °C przekracza próg −12 °C', () => {
    expect(tempExceeded(-10, 'czerwone', 'mrozony')).toBe(true)
  })
  it('brak pomiaru nie jest przekroczeniem', () => {
    expect(tempExceeded(null, 'drob', 'chlodzony')).toBe(false)
  })
})

describe('needsCorrectiveAction', () => {
  it('same b/z i K → nie trzeba', () => {
    expect(needsCorrectiveAction(komplet)).toBe(false)
  })
  it('ocena wizualna N → trzeba', () => {
    expect(needsCorrectiveAction({ ...komplet, visual: 'N' })).toBe(true)
  })
  it('kwalifikacja N → trzeba', () => {
    expect(needsCorrectiveAction({ ...komplet, verdict: 'N' })).toBe(true)
  })
  it('niezgodność kg N → trzeba', () => {
    expect(needsCorrectiveAction({ ...komplet, kgMatch: 'N' })).toBe(true)
  })
})

describe('checkIssues', () => {
  it('N bez opisu działania daje uwagę', () => {
    const uwagi = checkIssues({ ...komplet, verdict: 'N' }, 'drob', 'chlodzony')
    expect(uwagi.some(u => u.includes('działanie'))).toBe(true)
  })
  it('N z opisanym działaniem nie daje już uwagi', () => {
    const uwagi = checkIssues(
      { ...komplet, verdict: 'N', ncAction: 'Dostawę odesłano' }, 'drob', 'chlodzony')
    expect(uwagi).toEqual([])
  })
  it('przekroczony próg daje uwagę o temperaturze', () => {
    const uwagi = checkIssues({ ...komplet, tempMeat: 9 }, 'drob', 'chlodzony')
    expect(uwagi.some(u => u.includes('Temperatura'))).toBe(true)
  })
  it('komplet bez odchyleń nie ma uwag', () => {
    expect(checkIssues(komplet, 'drob', 'chlodzony')).toEqual([])
  })
})
