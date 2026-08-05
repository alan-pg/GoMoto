// Metro config para monorepo PNPM. Sem isto o Metro só procura node_modules
// dentro de apps/mobile e quebra ao resolver pacotes hoisted (react, expo, etc).
// Baseado no guia oficial: https://docs.expo.dev/guides/monorepos/
const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

// 1. Watch da raiz da monorepo: rebuild quando @gomoto/core ou data mudarem.
config.watchFolders = [monorepoRoot]

// 2. Resolução de node_modules em dois lugares (local + raiz) — essencial em PNPM
// porque dev deps de cada workspace ficam no node_modules local.
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// 3. Em PNPM, deps transitivas (ex.: whatwg-fetch do @expo/metro-runtime) ficam ao
// lado do pacote dentro do store (node_modules/.pnpm/<pkg>@.../node_modules/<dep>).
// Mantemos o lookup hierárquico ligado para que o Metro suba e encontre essas siblings.
config.resolver.unstable_enableSymlinks = true

// 4. Dedup forçada de libs que carregam estado em React Context (react,
// react-native, @tanstack/react-query). Sem isto, packages/data importa
// a cópia hoisted no node_modules raiz (atrelada ao react@18 do web) e
// o app mobile importa a cópia atrelada ao react@19 — dois Contexts
// distintos. Sintoma: "No QueryClient set" mesmo com QueryClientProvider
// no _layout.tsx.
const projectNodeModules = path.resolve(projectRoot, 'node_modules')
const singletonRoots = {
  react: path.join(projectNodeModules, 'react'),
  'react-native': path.join(projectNodeModules, 'react-native'),
  '@tanstack/react-query': path.join(projectNodeModules, '@tanstack/react-query'),
}
const defaultResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  for (const [pkg, root] of Object.entries(singletonRoots)) {
    if (moduleName === pkg || moduleName.startsWith(`${pkg}/`)) {
      const subpath = moduleName.slice(pkg.length)
      const target = subpath ? path.join(root, subpath) : root
      return context.resolveRequest(context, target, platform)
    }
  }
  if (defaultResolveRequest) return defaultResolveRequest(context, moduleName, platform)
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
