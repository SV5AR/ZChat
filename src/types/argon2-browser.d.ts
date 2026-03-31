declare module 'argon2-browser' {
  export const argon2: any
  export enum ArgonType { Argon2d = 0, Argon2i = 1, Argon2id = 2 }
}

declare module 'argon2-browser/dist/argon2-bundled.min.js' {
  export const argon2: any
  export enum ArgonType { Argon2d = 0, Argon2i = 1, Argon2id = 2 }
}
