import { Downloader } from '../../packages/downloader/src';

async function main() {
  const url = 'https://file-examples-com.github.io/uploads/2017/10/file-example_PDF_1MB.pdf';

  const dl = new Downloader(url, __dirname);
  const total = await dl.getTotalSize();
  console.log('total:', total);
}

main();
