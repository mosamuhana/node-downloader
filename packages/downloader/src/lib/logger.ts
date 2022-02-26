

export class Logger {
  constructor(private prefix: string) {}

  error(err: any) {
    err = typeof err === 'string' ? new Error(err) : err;
    console.error(
      `\x1b[1m\x1b[31mERROR! \x1b[0m\x1b[37m[${this.prefix}]\x1b[0m ${err}`
    );
  }

  log(msg: string) {
    console.log(`\x1b[37m[Downloader]\x1b[0m ${msg}`);
  }
}
