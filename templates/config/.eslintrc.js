module.exports = {
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: 'tsconfig.json',
    tsconfigRootDir: __dirname,
    sourceType: 'module',
  },
  plugins: ['@typescript-eslint/eslint-plugin'],
  root: true,
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ['.eslintrc.js', 'dist', 'node_modules', 'scripts'],
  rules: {
    '@typescript-eslint/interface-name-prefix': 'off',
    '@typescript-eslint/explicit-function-return-type': 'off',
    '@typescript-eslint/explicit-module-boundary-types': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    // Las reglas de arquitectura van por capa en `overrides` (abajo).
    // Las reglas de seguridad (cabeceras, CORS '*') se verifican en
    // scripts/verify-standards.mjs, porque como regla ESLint global darían
    // falsos positivos (p.ej. '*' en un SELECT o un glob).
  },
  overrides: [
    // CAPA DOMINIO: no importa NestJS, TypeORM, axios ni infraestructura.
    {
      files: ['src/**/core/domain/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'warn',
          {
            paths: [
              { name: '@nestjs/common', message: 'El dominio no debe importar NestJS. Mantén el core agnóstico de framework.' },
              { name: '@nestjs/core', message: 'El dominio no debe importar NestJS.' },
              { name: '@nestjs/typeorm', message: 'El dominio no debe conocer TypeORM. Usa un puerto outbound + adapter.' },
              { name: 'typeorm', message: 'El dominio no debe conocer TypeORM. Usa un puerto outbound + adapter.' },
              { name: 'axios', message: 'El dominio no debe hacer HTTP directo. Usa un puerto outbound.' },
            ],
            patterns: [
              { group: ['**/infrastructure/**'], message: 'El dominio no puede importar de infrastructure. La dependencia va hacia adentro.' },
            ],
          },
        ],
      },
    },
    // CAPA APLICACIÓN: no importa TypeORM, axios ni infraestructura.
    {
      files: ['src/**/core/application/**/*.ts'],
      rules: {
        'no-restricted-imports': [
          'warn',
          {
            paths: [
              { name: '@nestjs/typeorm', message: 'La capa application no debe conocer TypeORM.' },
              { name: 'typeorm', message: 'La capa application no debe conocer TypeORM.' },
              { name: 'axios', message: 'La capa application no debe hacer HTTP directo.' },
            ],
            patterns: [
              { group: ['**/infrastructure/**'], message: 'La capa application no puede importar de infrastructure. Usa puertos + tokens.' },
            ],
          },
        ],
      },
    },
    // TODO salvo config/main: prohibido process.env fuera de ConfigurationVariables.
    {
      files: ['src/**/*.ts'],
      excludedFiles: ['src/**/config/ConfigurationVariables.ts', 'src/**/config/*.ts', 'src/main.ts'],
      rules: {
        'no-restricted-syntax': [
          'warn',
          {
            selector: "MemberExpression[object.object.name='process'][object.property.name='env']",
            message: 'No leas process.env directamente. Toda config pasa por ConfigurationVariables (registerAs + Joi).',
          },
          {
            selector: "MemberExpression[object.name='process'][property.name='env']",
            message: 'No leas process.env directamente. Toda config pasa por ConfigurationVariables (registerAs + Joi).',
          },
        ],
      },
    },
  ],
};
