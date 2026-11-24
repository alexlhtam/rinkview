export function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export async function rinkPng(rink: SVGSVGElement, players: HTMLCanvasElement, overlay: SVGSVGElement): Promise<Blob> {
  const { x, y, width, height } = rink.viewBox.baseVal
  const output = rink.cloneNode(true) as SVGSVGElement
  const pixelWidth = 1920
  const pixelHeight = Math.round(pixelWidth * height / width)
  output.setAttribute('width', String(pixelWidth))
  output.setAttribute('height', String(pixelHeight))
  const image = document.createElementNS('http://www.w3.org/2000/svg', 'image')
  const scale = Math.min(players.width / width, players.height / height)
  const canvasWidth = players.width / scale
  const canvasHeight = players.height / scale
  image.setAttribute('x', String(x + (width - canvasWidth) / 2))
  image.setAttribute('y', String(y + (height - canvasHeight) / 2))
  image.setAttribute('width', String(canvasWidth))
  image.setAttribute('height', String(canvasHeight))
  image.setAttribute('href', players.toDataURL('image/png'))
  image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', players.toDataURL('image/png'))
  output.append(image, ...Array.from(overlay.children, node => node.cloneNode(true)))
  const markup = new XMLSerializer().serializeToString(output)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const raster = new Image()
    raster.src = url
    await raster.decode()
    const canvas = document.createElement('canvas')
    canvas.width = pixelWidth
    canvas.height = pixelHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('PNG export is not available.')
    context.fillStyle = '#e3eefb'
    context.fillRect(0, 0, pixelWidth, pixelHeight)
    context.drawImage(raster, 0, 0)
    return await new Promise((resolve, reject) => canvas.toBlob(blob =>
      blob ? resolve(blob) : reject(new Error('Could not encode the PNG.')), 'image/png'))
  } finally {
    URL.revokeObjectURL(url)
  }
}
