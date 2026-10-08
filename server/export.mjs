import sharp from 'sharp';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import { validateEdit, appError } from './common.mjs';
export const mm = value => value * 72 / 25.4;
export function sheetLayout(sizeMm) {
  const margin = 10, gap = 3;
  const cols = Math.floor((210 - 2 * margin + gap) / (sizeMm + gap));
  const rows = Math.floor((297 - 2 * margin + gap) / (sizeMm + gap));
  return { cols, rows, capacity: cols * rows, gap, x: (210 - (cols * sizeMm + (cols - 1) * gap)) / 2, y: (297 - (rows * sizeMm + (rows - 1) * gap)) / 2 };
}
export async function renderPNG(image, rawEdit) {
  const edit = validateEdit(rawEdit);
  const size = Math.round(edit.sizeMm / 25.4 * 300);
  const base = await sharp(image, { limitInputPixels: 36000000 }).rotate().resize(size,size,{fit:'cover'}).png().toBuffer();
  const clip = edit.shape === 'circle' ? `<circle cx="${size/2}" cy="${size/2}" r="${size/2}"/>` : `<rect width="${size}" height="${size}"/>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}"><defs><clipPath id="mask">${clip}</clipPath></defs><g clip-path="url(#mask)"><rect width="${size}" height="${size}" fill="#fffaf0"/><g transform="translate(${size/2+edit.x*size} ${size/2+edit.y*size}) rotate(${edit.rotation}) scale(${edit.zoom})"><image x="${-size/2}" y="${-size/2}" width="${size}" height="${size}" xlink:href="data:image/png;base64,${base.toString('base64')}"/></g></g></svg>`;
  return sharp(Buffer.from(svg)).withMetadata({density:300}).png().toBuffer();
}
export async function renderPDF(items) {
  const pdf = await PDFDocument.create();
  pdf.setTitle('Coaster Studio - Actual size 100%');
  pdf.setSubject('Print at actual size / 100%. Disable fit-to-page.');
  let page = null, activeSize = null, count = 0, layout;
  for (const item of items) {
    const edit = validateEdit(item.edit);
    if (!Number.isInteger(item.copies) || item.copies < 1 || item.copies > 30) throw appError('출력 수량은 1~30개입니다.');
    const png = await renderPNG(item.image, edit);
    const asset = await pdf.embedPng(png);
    for (let n=0;n<item.copies;n++) {
      if (!page || activeSize !== edit.sizeMm || count >= layout.capacity) { page=pdf.addPage([mm(210),mm(297)]); activeSize=edit.sizeMm; layout=sheetLayout(activeSize); count=0; }
      const col=count % layout.cols, row=Math.floor(count/layout.cols);
      const x=layout.x + col*(activeSize+layout.gap), top=layout.y + row*(activeSize+layout.gap);
      page.drawImage(asset,{x:mm(x),y:mm(297-top-activeSize),width:mm(activeSize),height:mm(activeSize)});
      if (edit.shape === 'circle') page.drawEllipse({x:mm(x+activeSize/2),y:mm(297-top-activeSize/2),xScale:mm(activeSize/2),yScale:mm(activeSize/2),borderWidth:0.35,borderColor:rgb(.72,.72,.72),borderOpacity:.7});
      else page.drawRectangle({x:mm(x),y:mm(297-top-activeSize),width:mm(activeSize),height:mm(activeSize),borderWidth:.35,borderColor:rgb(.72,.72,.72),borderOpacity:.7});
      count++;
    }
  }
  return Buffer.from(await pdf.save());
}
export async function calibrationPDF() {
  const pdf=await PDFDocument.create(), page=pdf.addPage([mm(210),mm(297)]), font=await pdf.embedFont(StandardFonts.Helvetica);
  const label=(t,x,y,size=12)=>page.drawText(t,{x:mm(x),y:mm(y),size,font,color:rgb(.2,.3,.25)});
  label('COASTER STUDIO / PRINT CALIBRATION',20,270,16);
  label('A4 - Actual size 100% - Disable "Fit to page"',20,257);
  page.drawEllipse({x:mm(105),y:mm(175),xScale:mm(45),yScale:mm(45),borderWidth:.6,borderColor:rgb(.25,.35,.3)});
  label('90 mm diameter',86,173,12);
  page.drawLine({start:{x:mm(50),y:mm(80)},end:{x:mm(100),y:mm(80)},thickness:1});
  for(let x=50;x<=100;x+=10) page.drawLine({start:{x:mm(x),y:mm(78)},end:{x:mm(x),y:mm(82)},thickness:.7});
  label('50 mm - measure with a ruler',50,70);
  label('If dimensions differ, adjust the printer scaling before the event.',20,35,10);
  return Buffer.from(await pdf.save());
}
