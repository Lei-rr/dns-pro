import globals from 'globals'
import js from '@eslint/js'
import pluginVue from 'eslint-plugin-vue'
import tseslint from 'typescript-eslint'

const typescriptRules = {
  '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-empty-object-type': 'off',
  'no-console': 'off',
}

export default tseslint.config(
  { ignores: ['dist', 'node_modules', 'web/dist', 'web/node_modules'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['src/**/*.ts', 'web/src/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: typescriptRules,
  },
  ...pluginVue.configs['flat/essential'],
  {
    files: ['web/src/**/*.vue'],
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: ['.vue'],
      },
    },
    rules: {
      ...typescriptRules,
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'error',
    },
  }
)
