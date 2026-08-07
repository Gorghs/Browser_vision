import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Single flat config for the whole workspace. Packages under apps/ and packages/
 * inherit these rules; they only add a config block here when they genuinely
 * need different globals or environment-specific rules.
 *
 * Type-aware linting is enabled for TypeScript sources. Rather than the full
 * `recommendedTypeChecked` set — which is mostly noise around Chrome's loosely
 * typed APIs — only the rules that catch real defects in async code are on.
 */
export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/build/**', '**/coverage/**'],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
    },
    rules: {
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-implicit-coercion': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },

  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      // Dropped promises are the defect this codebase is most exposed to:
      // Chrome event listeners are synchronous, so an un-awaited async call
      // inside one fails silently.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
    },
  },

  {
    files: ['*.mjs', '*.js', '*.config.*'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Must stay last so formatting-related rules are switched off for Prettier.
  prettier,
);
