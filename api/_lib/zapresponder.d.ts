export declare function normalizeBrazilPhone(value: unknown): string;
export declare function getZapResponderConfigFromEnv(): {
  apiBaseUrl: string;
  apiToken: string;
  departmentId: string;
  departmentName: string;
  phoneLabel: string;
  configured: boolean;
  missing: string[];
};
export declare function callZapResponder(path: string, options?: any): Promise<any>;
export declare function sendZapTextMessage(args: {
  number: string;
  message: string;
  showInChat?: boolean;
  departmentId?: string;
  token?: string;
  apiBaseUrl?: string;
}): Promise<any>;
