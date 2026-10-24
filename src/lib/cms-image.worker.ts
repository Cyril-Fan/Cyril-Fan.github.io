import encode, { init } from '@jsquash/webp/encode.js'
import wasm from '@jsquash/webp/codec/enc/webp_enc.wasm?url'
import simdWasm from '@jsquash/webp/codec/enc/webp_enc_simd.wasm?url'

// Only re-encoded sRGB pixels cross this boundary: camera metadata never does.
self.onmessage = async (event: MessageEvent<ImageData>) => {
  try {
    await init({ locateFile: (path:string) => path.includes('simd') ? simdWasm : wasm })
    const result = await encode(event.data, { lossless:1, near_lossless:100, exact:1, quality:100, method:4 })
    self.postMessage({ bytes:result }, { transfer:[result] })
  } catch {
    self.postMessage({ error:'图片转换未完成，请稍后重试或选择较小图片。' })
  }
}
