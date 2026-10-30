// Składa jeden plik HTML do publikacji jako Artifact:
// React/ReactDOM z cdnjs (UMD), własny kod i CSS (z osadzonymi czcionkami) inline.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
const dir = 'dist-artifact/assets'
const files = readdirSync(dir)
const js = files.filter(f => f.endsWith('.js')).map(f => readFileSync(`${dir}/${f}`, 'utf8')).join('\n')
const css = files.filter(f => f.endsWith('.css')).map(f => readFileSync(`${dir}/${f}`, 'utf8')).join('\n')
const safeJs = js.replace(/<\/script/gi, '<\\/script')
const html = `<title>PROTRIMA MES</title>
<meta name="description" content="Interaktywne demo interfejsu PROTRIMA: Pulpit zakładu i Zamówienia. Dane demonstracyjne.">
<style>
${css}
</style>
<div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>
${safeJs}
</script>
`
writeFileSync('dist-artifact/protrima.html', html)
console.log('protrima.html', (html.length / 1024).toFixed(0), 'KB')
