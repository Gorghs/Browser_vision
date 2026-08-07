import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

/**
 * Single flat config for the whole workspace. Packages under apps/ and packages/
 * inherit these rules; they only add a config block here when they genuinely
 * need different globals or environment-specific rules.
 *
 * Type-aware linting is intentionally not enabled yet: it needs a tsconfig per
 * package, and no package exists at this point. It is switched on in the task
 * that introduces the first workspace package.
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
    files: ['*.mjs', '*.js', '*.config.*'],
    languageOptions: {
      globals: globals.node,
    },
  },

  // Must stay last so formatting-related rules are switched off for Prettier.
  prettier,
);
