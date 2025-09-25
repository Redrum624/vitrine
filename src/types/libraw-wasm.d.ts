declare module 'libraw-wasm' {
  export interface LibRawMetadata {
    make: string;
    model: string;
    width: number;
    height: number;
    iso: number;
    aperture: number;
    shutter: number;
    focal_length: number;
    timestamp: number;
    colors: number;
    color_desc: string;
    filters: number;
    white_balance: {
      camera_wb: number[];
      daylight_wb: number[];
    };
  }

  export interface LibRawOptions {
    use_camera_wb?: boolean;
    use_auto_wb?: boolean;
    greybox?: [number, number, number, number];
    user_wb?: number[];
    user_qual?: number;
    half_size?: boolean;
    four_color_rgb?: boolean;
    user_cspace?: number;
    output_color?: number;
    output_bps?: number;
    exp_correc?: boolean;
    exp_shift?: number;
    exp_preser?: number;
    bright?: number;
    user_gamma?: number[];
    threshold?: number;
    aber?: number[];
    user_black?: number;
    user_sat?: number;
    cropbox?: [number, number, number, number];
  }

  export interface LibRawInstance {
    open(buffer: Uint8Array): Promise<void>;
    metadata(): Promise<LibRawMetadata>;
    imageData(): Promise<Uint8Array>;
    configure(options: LibRawOptions): void;
    close(): void;
  }

  export interface LibRawConstructor {
    new(): LibRawInstance;
  }

  const LibRaw: LibRawConstructor;
  export default LibRaw;
}