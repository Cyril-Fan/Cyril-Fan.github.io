export type Field={key:string;label:string;en?:string;type?:'text'|'textarea'|'markdown'|'image'|'checkbox'|'group'|'list'|'number'|'date'|'select';fields?:Field[];options?:string[]}
const t=(key:string,label:string,en?:string):Field=>({key,label,en})
const m=(key:string,label:string,en?:string):Field=>({key,label,en,type:'markdown'})
const list=(key:string,label:string,fields:Field[],en?:string):Field=>({key,label,en,type:'list',fields})
const g=(key:string,label:string,fields:Field[]):Field=>({key,label,type:'group',fields})
export const friendFields:Field[]=[t('name','名称','Name'),t('intro','简介','Description'),t('link','网站地址','Website'),{...t('avatar','头像','Avatar'),type:'image'},t('feed','RSS / Atom')]
const profileFields:Field[]=[
 t('name','显示姓名','Display name'),t('homeName','首页姓名','Home name'),t('location','所在地','Location'),t('role','身份','Role'),t('spoiler','悬停介绍','Spoiler'),
 {...t('intro','首页介绍','Home introduction'),type:'textarea'},m('about','关于正文','About body'),t('photoAlt','照片说明','Photo description'),
 {...t('interests','研究兴趣（每行一项）','Interests (one per line)'),type:'textarea'},t('school','学校','School'),t('major','专业','Major'),t('period','就读时间','Period'),t('contactIntro','联系介绍','Contact introduction')
]
const links=[t('type','链接类型','Type'),t('href','链接地址','URL'),t('label','显示文字（可选）','Label (optional)')]
const academicFields:Field[]=[
 m('background','学术背景','Background'),t('cv','简历链接（可选）','CV link (optional)'),
 list('interests','研究兴趣',[t('title','标题','Title'),t('description','说明','Description'),{...t('icon','图标','Icon'),type:'select',options:['cpu','brain','image','robot','code','book','earth']}],'Research interests'),
 list('publications','论文',[
  t('title','标题','Title'),t('venue','会议 / 期刊','Venue'),t('year','年份','Year'),
  {...t('type','类型','Type'),type:'select',options:['conference','journal','workshop','preprint']},
  {...t('status','状态','Status'),type:'select',options:['published','accepted','under-review','preprint']},
  list('authors','作者',[t('name','姓名','Name'),t('homepage','主页','Homepage'),{...t('isMe','本人','Me'),type:'checkbox'},{...t('isEqual','共同一作','Equal contribution'),type:'checkbox'},{...t('isCoreContributor','核心贡献者','Core contributor'),type:'checkbox'},{...t('role','角色','Role'),type:'select',options:['','corresponding','project-leader']}],'Authors'),
  {...t('authorsAlphabetical','作者按字母排列','Alphabetical authors'),type:'checkbox'},
  {...t('abstract','摘要','Abstract'),type:'textarea'},list('links','相关链接',links,'Links'),
  {...t('citations','引用数（可选）','Citations (optional)'),type:'number'}
 ],'Publications'),
 list('projects','项目',[t('title','名称','Title'),{...t('description','说明','Description'),type:'textarea'},t('category','分类','Category'),{...t('status','状态','Status'),type:'select',options:['active','completed','archived']},{...t('image','图片','Image'),type:'image'},list('links','相关链接',links,'Links')],'Projects')
]
export const jsonFields:Record<string,Field[]>={
 profile:[g('zh','中文',profileFields),g('en','English',profileFields),{...t('avatar','主页头像','Home avatar'),type:'image'},{...t('photo','关于页照片','About photo'),type:'image'},t('email','公开联系邮箱','Public email'),t('github','GitHub 用户名','GitHub username'),t('schoolUrl','学校链接','School link')],
 academic:[g('zh','中文',academicFields),g('en','English',academicFields)]
}
export const articleFields:Field[]=[t('title','标题','Title'),{...t('description','摘要','Description'),type:'textarea'},{...t('publishDate','发布日期','Publish date'),type:'date'},{...t('updatedDate','更新日期（可选）','Updated date (optional)'),type:'date'},t('category','分类','Category'),t('tags','标签（逗号分隔）','Tags (comma separated)'),g('heroImage','封面 / Cover',[{...t('src','图片','Image'),type:'image'},t('alt','图片说明','Alt text'),t('color','主题色（可选）','Accent (optional)')]),t('source','来源链接（可选）','Source URL (optional)'),t('pixivLink','Pixiv 作品编号（保留原字段）','Pixiv artwork ID (legacy)'),{...t('comment','允许评论','Enable comments'),type:'checkbox'},{...t('draft','暂不公开（提交后仍不展示）','Keep unpublished'),type:'checkbox'}]
export const collectionFields:Field[]=[t('title','标题','Title'),t('title_en','英文标题','English title'),{...t('description','介绍','Description'),type:'textarea'},{...t('description_en','英文介绍','English description'),type:'textarea'},g('heroImage','封面 / Cover',[{...t('src','图片','Image'),type:'image'},t('alt','图片说明','Alt text')]),{...t('bloglist','文章网址顺序（每行一个）','Article slugs in order (one per line)'),type:'textarea'}]
