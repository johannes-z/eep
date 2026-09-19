declare module 'bun-serialport' {
  interface SerialPortOptions {
    path: string;
    baudRate: number;
    dataBits?: 5 | 6 | 7 | 8;
    stopBits?: 1 | 2;
    parity?: 'none' | 'even' | 'odd';
    rtscts?: boolean;
    xon?: boolean;
    xoff?: boolean;
    xany?: boolean;
    hupcl?: boolean;
    lock?: boolean;
    autoOpen?: boolean;
    readBufferSize?: number;
    readInterval?: number;
  }

  interface SerialPortError extends Error {
    disconnected?: boolean;
  }

  class SerialPort {
    readonly path: string;
    readonly baudRate: number;
    readonly isOpen: boolean;

    constructor(options: SerialPortOptions);
    open(): Promise<void>;
    close(): Promise<void>;
    write(data: Uint8Array | ArrayBuffer | number[] | string): Promise<void>;
    on(event: 'error', listener: (error: SerialPortError) => void): this;
    on(event: 'close', listener: (error?: SerialPortError) => void): this;
    on(event: 'open', listener: () => void): this;
    on(event: 'data', listener: (data: Uint8Array) => void): this;
  }

  export { SerialPort };
}
