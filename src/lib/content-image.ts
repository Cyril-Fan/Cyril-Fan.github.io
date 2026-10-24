const images=import.meta.glob<string>('/src/{assets,content}/**/*.{png,jpg,jpeg,webp,gif,avif}',{eager:true,query:'?url',import:'default'})
export function contentImage(value:string|undefined,sourcePath=''){
  if(!value)return ''
  if(value.startsWith('/src/'))return images[value]||''
  if(!value.startsWith('/')&&!/^https:\/\//.test(value)&&sourcePath){
    const path=new URL(value,'https://content.invalid/'+sourcePath).pathname
    return images[path]||''
  }
  return value
}
export function resolveArticleImages(html:string,sourcePath=''){
  return html.replace(/(<img\b[^>]*\bsrc=")([^"]*)(")/g,(_all,before,url,after)=>before+contentImage(url,sourcePath)+after)
}
