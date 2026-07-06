import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommended,
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
