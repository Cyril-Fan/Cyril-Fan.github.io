// About tool icons are SVG source files, inlined at build time through the theme's Svg component.
export const tools = [
  { name:'VS Code', description:{zh:'代码编辑器',en:'Code editor'}, href:'https://code.visualstudio.com/', icon:import('../assets/tools/vscode.svg?raw') },
  { name:'ChatGPT', description:{zh:'AI 助手',en:'AI assistant'}, href:'https://chatgpt.com/', icon:import('../assets/tools/chatgpt.svg?raw') },
  { name:'Edge', description:{zh:'网页浏览器',en:'Web browser'}, href:'https://www.microsoft.com/edge', icon:import('../assets/tools/edge.svg?raw') },
  { name:'SakuraCat', description:{zh:'网络工具',en:'Network tool'}, href:'https://sakuracat-cn1.com/', icon:import('../assets/tools/sakuracat.svg?raw') }
]
