import { validateImage } from '../../supabase/functions/_shared/git-content'
const validateWebp=(bytes:Uint8Array)=>validateImage('public/media/check.webp',bytes)

/** A local codec also works where canvas.toBlob cannot encode WebP (Safari). */
export async function encodeCMSImage(canvas:HTMLCanvasElement):Promise<Blob> {
  const context=canvas.getContext('2d')
  if(!context)throw new Error('浏览器无法读取图片。')
  const pixels=context.getImageData(0,0,canvas.width,canvas.height)
  const worker=new Worker(new URL('./cms-image.worker.ts',import.meta.url),{type:'module'})
  try {
    const bytes=await new Promise<ArrayBuffer>((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('图片转换超时，请缩小图片后重试。')),60000)
      worker.onmessage=event=>{clearTimeout(timer);event.data.error?reject(new Error(event.data.error)):resolve(event.data.bytes)}
      worker.onerror=()=>{clearTimeout(timer);reject(new Error('图片转换工具加载失败，请检查网络后重试。'))}
      worker.postMessage(pixels,[pixels.data.buffer])
    })
    validateWebp(new Uint8Array(bytes))
    return new Blob([bytes],{type:'image/webp'})
  } finally {worker.terminate()}
}
