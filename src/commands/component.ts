import * as svgjs from '@svgdotjs/svg.js'
import { Command, command, option, Options, param } from 'clime'
import { Canvas, Component } from 'figma-js'
import { writeFileSync } from 'fs'
import { existsSync, mkdirpSync, readFileSync } from 'fs-extra'
import { dirname, resolve } from 'path'
import { createSVGWindow } from 'svgdom'
import { FigmaDocument } from '../classes/FigmaDocument'

export interface ComponentJson {
  fileId: string
  pageName: string
  mappings: {
    name: string
    output: string
  }[]
}

export class ComponentOptions extends Options {
  @option({ flag: 'v', description: 'verbose', toggle: true, default: false }) verbose = false
  @option({ flag: 'a', description: 'access token', default: process.env.FIGMA_ACCESS_TOKEN }) accessToken?: string
}

export function loadSvg(svg: string): SVGSVGElement {
  const window = createSVGWindow();
  (svgjs as any).registerWindow(window, window.document)
  const canvas = svgjs.SVG(window.document.documentElement)
  canvas.svg(svg)
  return window.document.documentElement.firstElementChild
}

export type ParserTarget = 'fill' | 'stroke'

export interface ParserInstruction {
  target: ParserTarget
  args: string[]
}

const ID_REGEX = /^\$(fill)\(([a-zA-Z0-9\s,]+)\)/

// $fill(topMenuHeadingIconColor, backgroundColor)
export function parseId(id: string): ParserInstruction | null {
  const match = id.match(ID_REGEX)
  if (!match) { return null }
  const target = match[1] as ParserTarget
  const args = match[2].replace(/\s/g, '').split(',')
  return { target, args }
}

@command({ description: 'Generate Angular Component Template from figma SVG' })
export default class ComponentCommand extends Command {
  async execute(@param({ name: 'input', description: 'path to components.json', required: true }) input: string, { accessToken, verbose }: ComponentOptions) {
    if (!accessToken) { return 'Missing Figma personal access token. Please provide via --access-token or FIGMA_ACCESS_TOKEN environment variable.' }
    if (!existsSync(input)) { return `No components JSON found at ${resolve(input)}` }
    const { fileId, pageName, mappings }: ComponentJson = JSON.parse(readFileSync(input, 'utf8'))
    this.log(`loading Figma document '${fileId}'`, verbose)
    const document = await FigmaDocument.load({ fileId, accessToken })
    const page = document.extract<Canvas>([document.root], 'CANVAS').find(({ name }) => name === pageName)
    if (!page) { return `Page '${pageName}' doesn't exist` }
    const components = document.extract<Component>([page], 'COMPONENT')
    const svgs = await document.download(components)
    for (const mapping of mappings) {
      const component = components.find((entry) => entry.name === mapping.name)
      if (!component) { return `Component '${mapping.name}' doesn't exist` }
      const svg = svgs[component.name]
      if (!svg) { return `No SVG export found for '${component.name}'` }

      const element = loadSvg(svg)
      element.removeAttribute('width')
      element.removeAttribute('height')
      for (const node of element.querySelectorAll('[id]')) {
        const instruction = parseId(node.getAttribute('id')!)
        if (instruction) {
          if (node.hasAttribute(instruction.target)) {
            instruction.args.push(node.getAttribute(instruction.target)!)
            node.removeAttribute(instruction.target)
          }
          node.setAttribute(`[attr.${instruction.target}]`, `color(${instruction.args.map((arg) => `'${arg}'`).join(', ')})`)
          node.removeAttribute('id')
        }
      }

      mkdirpSync(dirname(mapping.output))
      writeFileSync(mapping.output, element.outerHTML, 'utf8')
      this.log(`generated ${mapping.output}`, verbose)
    }
  }

  log(message: string, verbose = true) {
    if (!verbose) { return }
    console.info(`~> ${message}`)
  }
}