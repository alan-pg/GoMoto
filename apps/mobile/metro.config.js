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

// 3. Desliga lookup hierárquico (sobe diretórios procurando node_modules) — quebra
// em PNPM porque pode achar versões erradas via store global. As paths acima já
// cobrem todos os casos legítimos.
config.resolver.disableHierarchicalLookup = true

module.exports = config
