export interface EEPPackageOptions {
  senderId: number[],
  receiverId?: number[],
  value?: number
}

export interface EEPPackage {
  // getPackage: (options: EEPPackageOptions) => EEPPackage,
  send: () => EEPPackage
}
