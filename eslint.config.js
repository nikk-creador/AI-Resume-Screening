import antfu from '@antfu/eslint-config';
import css from '@eslint/css';
import pluginQuery from '@tanstack/eslint-plugin-query';
import simpleImportSort from 'eslint-plugin-simple-import-sort';

const noComments = {
  meta: {
    type: 'problem',
    docs: { description: 'Disallow comments in application source' },
    schema: [],
    messages: { unexpected: 'Comments are not allowed in application source.' },
  },
  create(context) {
    return {
      Program() {
        for (const comment of context.sourceCode.getAllComments()) {
          context.report({ loc: comment.loc, messageId: 'unexpected' });
        }
      },
    };
  },
};

const colorTokenMessage = 'Use a shared color token from src/theme/colors.ts.';
const restrictedColorSyntax = [
  { selector: 'Literal[value=/^#[\\da-f]{3,8}$/i]', message: colorTokenMessage },
  {
    selector: 'Literal[value=/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|color)\\(/i]',
    message: colorTokenMessage,
  },
  {
    selector:
      'Literal[value=/^(?:aqua|black|blue|fuchsia|gray|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|transparent|white|yellow|currentcolor)$/i]',
    message: colorTokenMessage,
  },
];

const restrictedCssColorSyntax = [
  { selector: 'Hash', message: colorTokenMessage },
  {
    selector: 'Function[name=/^(?:rgb|rgba|hsl|hsla|hwb|lab|lch|color)$/i]',
    message: colorTokenMessage,
  },
  {
    selector:
      'Identifier[name=/^(?:aqua|black|blue|fuchsia|gray|green|lime|maroon|navy|olive|orange|purple|red|silver|teal|transparent|white|yellow|currentcolor)$/i]',
    message: colorTokenMessage,
  },
];

const antfuConfig = antfu(
  {
    ignores: ['dist/**', 'node_modules/**', 'backend/**'],
    react: true,
    typescript: true,
    stylistic: false,
  },
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx,mts,cts}'],
    rules: {
      'no-alert': 'error',
      'no-console': 'error',
      'no-debugger': 'error',
      'no-eval': 'error',
      'no-new-func': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-implicit-coercion': 'error',
      'no-warning-comments': 'error',
      curly: 'off',
      'no-return-await': 'off',
      'prefer-promise-reject-errors': 'off',
      'require-await': 'off',
      'ts/await-thenable': 'off',
      'ts/no-floating-promises': 'off',
      'ts/no-misused-promises': 'off',
      'ts/prefer-promise-reject-errors': 'off',
      'ts/require-await': 'off',
      'ts/return-await': 'off',
    },
    linterOptions: {
      reportUnusedDisableDirectives: 'error',
      reportUnusedInlineConfigs: 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { local: { rules: { 'no-comments': noComments } } },
    rules: {
      'local/no-comments': 'error',
      'no-restricted-syntax': ['error', ...restrictedColorSyntax],
      'no-else-return': 'error',
      'prefer-destructuring': ['error', { array: false, object: true }],
      'prefer-template': 'error',
      'ts/ban-ts-comment': 'error',
      'ts/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          caughtErrors: 'none',
          varsIgnorePattern: '^_',
        },
      ],
    },
  },
  {
    files: ['src/theme/colors.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
);

const resolvedAntfuConfig = await antfuConfig.toConfigs();
const antfuRuleNames = new Set(
  resolvedAntfuConfig.flatMap((config) => Object.keys(config.rules ?? {})),
);

export default [
  ...resolvedAntfuConfig,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      '@tanstack/query': pluginQuery,
      'simple-import-sort': simpleImportSort,
    },
    rules: {
      ...pluginQuery.configs.recommended.rules,
      'perfectionist/sort-imports': 'off',
      'simple-import-sort/imports': [
        'error',
        {
          groups: [
            ['^react$', '^\\w'],
            ['^@', '^(@internal|@custom|@mylib)(/.*|$)'],
            ['^\\.\\./?$', '^\\./(?=.*/)(?!/?$)', '^\\.(?!/?$)', '^\\./?$', '^\\.\\.(?!/?$)'],
          ],
        },
      ],
      'simple-import-sort/exports': 'error',
      'no-console': 'error',
    },
  },
  {
    ...css.configs.recommended,
    files: ['src/**/*.css'],
    language: 'css/css',
    rules: {
      ...Object.fromEntries([...antfuRuleNames].map((ruleName) => [ruleName, 'off'])),
      ...css.configs.recommended.rules,
      'css/no-invalid-properties': ['error', { allowUnknownVariables: true }],
      'css/use-baseline': 'off',
      'no-restricted-syntax': ['error', ...restrictedCssColorSyntax],
    },
  },
];
