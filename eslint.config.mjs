import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import vue from 'eslint-plugin-vue'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Vue SFCs: the bug-catching rules only. The stricter presets are template
  // formatting, which the repo leaves to editors.
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
    rules: {
      // TypeScript already reports undefined names, and no-undef does not know
      // browser globals or Vite's `define` constants (__ADMIN_PREFIX__).
      'no-undef': 'off',
      // Guards against clashing with HTML tags in in-DOM templates. Components
      // here are imported and used by PascalCase name (Footer, Sidebar), so a
      // single word cannot clash.
      'vue/multi-word-component-names': 'off',
    },
  },
  {
    // Generated code is not hand-written: drizzle/route codegen (.manguito) and
    // built/served assets (dist, public) should never be linted.
    ignores: ['**/dist/**', '**/node_modules/**', '**/.manguito/**', '**/public/**'],
  },
  {
    rules: {
      // A leading underscore marks a deliberately-unused binding — a convention
      // used across the codebase for required-but-unused params and placeholders.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
)
