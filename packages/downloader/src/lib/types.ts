export enum DownloadState {
  IDLE = 'IDLE',
  SKIPPED = 'SKIPPED',
  STARTED = 'STARTED',
  DOWNLOADING = 'DOWNLOADING',
  RESUMED = 'RESUMED',
  FINISHED = 'FINISHED',
  // not finished states
  PAUSED = 'PAUSED',
  STOPPED = 'STOPPED',
  RETRY = 'RETRY',
  FAILED = 'FAILED',
}

export interface DownloadStats {
  /** file name */
  name: string;
  /**
   * total size that needs to be downloaded in bytes,
   * (will be set as 'null' if content-length header is not available)
  */
  total: number;
  /** downloaded size in bytes */
  downloaded: number;
  /** progress porcentage 0-100%, (will be set as 0 if total is null) */
  progress: number;
  /** download speed in bytes */
  speed: number;
}

export interface BaseStats {
  /** total file size got from the server */
  totalSize: number | null;
  /** original file name */
  fileName: string;
  /** original path name */
  filePath: string;
  /** the downloaded amount */
  downloadedSize: number;
}

export interface DownloadInfoStats extends BaseStats {
  /** if the download is a resume */
  isResumed: boolean;
}

export interface DownloadEndedStats extends BaseStats {
  /** total size of file on the disk */
  onDiskSize: number;
  /** true/false if the download endend but still incomplete */
  incomplete: boolean;
}

export interface FileRenamedStats {
  /** modified path name */
  path: string;
  /** modified file name */
  fileName: string;
  /** original path name */
  prevPath: string;
  /** original file name */
  prevFileName: string;
}

export interface ErrorStats {
  /** Error message */
  message: string;
  /** Http status response if available */
  status?: number;
  /** Http body response if available */
  body?: string;
}

export interface FilenameOptions {
  name: string;
  /**
   * The extension of the file. It may be a boolean: `true` will use the `name` property
   * as the full file name (including the extension), `false` will keep the extension of
   * the downloaded file.
   * @default: false
   */
  ext?: string | boolean;
}

export type FilenameCallback = (fileName: string, filePath: string, contentType?: string) => string;

export type FilenameDefinition = string | FilenameCallback | FilenameOptions;

export interface RetryOptions {
  maxRetries: number;
  /** in milliseconds */
  delay: number;
}

export interface OverrideOptions {
  skip?: boolean;
  skipSmaller?: boolean;
}

export type RequestMethod = "GET" | "PUT" | "POST" | "DELETE" | "OPTIONS" | "HEAD";

export interface DownloadOptions {
  /** parameter accepted by http.request write function req.write(body) (default(null)) */
  body?: any;
  /** Request Method Verb */
  method?: RequestMethod,
  /** Custom HTTP Header ex: Authorization, User-Agent */
  headers?: any;
  /** Custom filename when saved */
  fileName?: FilenameDefinition;
  retry?: boolean | RetryOptions;
  /** If the server does not return the "accept-ranges" header, can be force if it does support it */
  forceResume?: boolean;
  /** remove the file when is stopped (default:true) */
  removeOnStop?: boolean;
  /** remove the file when fail (default:true) */
  removeOnFail?: boolean;
  /** Behavior when local file already exists (default:false)*/
  override?: boolean | OverrideOptions;
  /** interval time of the 'progress.throttled' event will be emitted (default:1000) */
  progressThrottle?: number;
  /** Override the http request options */
  httpRequestOptions?: any;
  /** Override the https request options, ex: to add SSL Certs */
  httpsRequestOptions?: any;
}

export interface StatsEstimate {
  time: number;
  bytes: number;
  prevBytes: number;
  throttleTime: number;
}

// this.emit(Events.retry, this._retryCount, retry, err);
export interface RetryState extends RetryOptions {
  retryCount: number;
  //options: boolean | RetryOptions;
  error: any;
}

export type VoidCallback = () => void;
export type ParamCallback<T> = (param: T) => void;

export const Events = {
  start: 'start',
  stop: 'stop',
  pause: 'pause',
  timeout: 'timeout',
  resume: 'resume',
  error: 'error',
  end: 'end',
  skip: 'skip',
  download: 'download',
  renamed: 'renamed',
  stateChanged: 'stateChanged',
  progress: 'progress',
  progressThrottled: 'progressThrottled',
  retry: 'retry',
};
