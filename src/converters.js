const fs = require('fs')
const util = require('util')
const mjpage = require('mathjax-node-page')
const pug = require('pug')
const writeFile = util.promisify(fs.writeFile)
const cheerio = require('cheerio')
const path = require('path')
const csv = require('csvtojson')
const html2jade = require('html2jade');

function formatTemplate (tempName, data) {
  return pug.renderFile(path.join(__dirname, 'templates', tempName + '.pug'), data)
}


exports.mermaidToSvg = async function (mermaidPath, page) {
  var mermaidSpec = fs.readFileSync(mermaidPath, 'utf8')
  var html = formatTemplate('mermaid', { mermaidSpec })
  await page.setContent(html)
  await page.waitForSelector('#graph svg')
  var svg = await page.evaluate(function () {
    var el = document.querySelector('#graph svg')
    el.removeAttribute('height')
    el.classList.add('mermaid-svg')
    return el.outerHTML
  })
  var svgPath = mermaidPath.substr(0, mermaidPath.lastIndexOf('.')) + '.svg'
  await writeFile(svgPath, svg)
}


exports.flowchartToSvg = async function (flowchartPath, page) {
  var flowchartSpec = fs.readFileSync(flowchartPath, 'utf8')
  var flowchartConf = '{}'
  var possibleConfs = [
    path.join(path.resolve(flowchartPath, '..'), 'flowchart.default.json'),
    flowchartPath + '.json'
  ]
  for (var myPath of possibleConfs) {
    if (fs.existsSync(myPath)) {
      flowchartConf = fs.readFileSync(myPath, 'utf8')
    }
  }
  var html = formatTemplate('flowchart', { flowchartSpec, flowchartConf })
  // console.log(html)
  await page.setContent(html)
  await page.waitForSelector('#chart svg')
  var svg = await page.evaluate(function () {
    var el = document.querySelector('#chart svg')
    el.removeAttribute('height')
    el.removeAttribute('width')
    el.classList.add('flowchart-svg')
    return el.outerHTML
  })
  var svgPath = flowchartPath.substr(0, flowchartPath.lastIndexOf('.')) + '.svg'
  await writeFile(svgPath, svg)
}


exports.vegaliteToSvg = async function (vegalitePath, page) {
  var vegaliteSpec = fs.readFileSync(vegalitePath, 'utf8')
  var html = formatTemplate('vegalite', { vegaliteSpec })
  // var tempHTML = vegalitePath + '.htm'
  // await writeFile(tempHTML, html)
  // await page.goto('file:' + tempHTML);
  await page.setContent(html)
  await page.waitForSelector('#vis svg')
  var svg = await page.evaluate(function () {
    var el = document.querySelector('#vis svg')
    el.removeAttribute('height')
    el.removeAttribute('width')
    return el.outerHTML
  })
  var svgPath = vegalitePath.substr(0, vegalitePath.length - '.vegalite.json'.length) + '.svg'
  await writeFile(svgPath, svg)
}


exports.tableToPug = function (tablePath) {
  var extension, header
  var rows = []
  csv({noheader: true})
    .fromFile(tablePath)
    .on('csv', (csvRow) => { rows.push(csvRow) })
    .on('done', (error) => {
      if (error) {
        console.log('error', error)
      } else {
        if (tablePath.endsWith('.htable.csv')) {
          extension = '.htable.csv'
          header = rows.shift()
        } else {
          extension = '.table.csv'
          header = null
        }
        var html = formatTemplate('table', { header: header, tbody: rows })
        var pugPath = tablePath.substr(0, tablePath.length - extension.length) + '.pug'
        html2jade.convertHtml(html, {bodyless: true}, function (err, jade) {
          if (err) {
            console.log(err)
          }
          writeFile(pugPath, jade)
        })
      }
    })
}

function parseDataUrl (dataUrl) {
  // from https://intoli.com/blog/saving-images/
  const matches = dataUrl.match(/^data:(.+);base64,(.+)$/);
  if (matches.length !== 3) {
    throw new Error('Could not parse data URL.');
  }
  return { mime: matches[1], buffer: Buffer.from(matches[2], 'base64') };
};

exports.chartjsToPNG = async function (chartjsPath, page) {
  var chartSpec = fs.readFileSync(chartjsPath, 'utf8')
  var html = formatTemplate('chartjs', { chartSpec })
  var tempHTML = chartjsPath + '.htm'
  await writeFile(tempHTML, html)
  // await page.goto('file:' + tempHTML);
  await page.setContent(html)
  await page.waitForFunction(() => window.pngData)
  const dataUrl = await page.evaluate(() => window.pngData)
  const { buffer } = parseDataUrl(dataUrl)
  var pngPath = chartjsPath.substr(0, chartjsPath.length - '.chart.js'.length) + '.png'
  await writeFile(pngPath, buffer, 'base64')
}

function asyncMathjax (html) {
  return new Promise(resolve => {
    mjpage.mjpage(html, {
      format: ['TeX']
    }, {
      mml: true,
      css: true,
      html: true
    }, response => resolve(response))
  })
}

function getMatch (string, query) {
  var result = string.match(query)
  if (result) {
    result = result[1]
  }
  return result
}

exports.masterDocumentToPDF = async function (masterPath, page, tempHTML, outputPath) {
  var html
  if (masterPath.endsWith('.pug')) {
    try {
      html = pug.renderFile(masterPath)
    } catch (error) {
      console.log(error.message)
      console.error('There was a Pug error (see above)'.red)
      return
    }
  } else {
    html = fs.readFileSync(masterPath, 'utf8')
  }
  html = await asyncMathjax(html)
  var parsedHtml = cheerio.load(html)
  html = parsedHtml.html() // adds html, body, head.
  var headerTemplate = parsedHtml('template.header').html()
  var footerTemplate = parsedHtml('template.footer').html()
  // await page.setContent(html)
  await writeFile(tempHTML, html)
  await page.goto('file:' + tempHTML, {waitUntil: 'networkidle2'});
  // await page.waitForNavigation({ waitUntil: 'networkidle2' })
  var options = {
    path: outputPath,
    displayHeaderFooter: headerTemplate || footerTemplate,
    headerTemplate,
    footerTemplate,
    printBackground: true
  }
  var width = getMatch(html, /-relaxed-page-width: (\S+);/m)
  if (width) {
    options.width = width
  }
  var height = getMatch(html, /-relaxed-page-height: (\S+);/m)
  if (height) {
    options.height = height
  }
  var size = getMatch(html, /-relaxed-page-size: (\S+);/m)
  if (size) {
    options.size = size
  }
  await page.pdf(options)
}
