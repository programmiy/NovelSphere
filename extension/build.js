const esbuild = require('esbuild');
const isWatch = process.argv.includes('--watch');

const options = {
  entryPoints: {
    content: 'src/content.ts',
    background: 'src/background/index.ts',
  },
  bundle: true,
  outdir: '.',
  target: 'chrome100',
  sourcemap: true,
  logLevel: 'info',
};

if (isWatch) {
  esbuild.context(options).then(ctx => {
    ctx.watch();
    console.log('[esbuild] Watching extension files for changes...');
  });
} else {
  esbuild.build(options).catch(() => process.exit(1));
}
