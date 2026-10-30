export interface IHttpClientService {
  get(url: string, options?: any): Promise<any>
  post(url: string, body?: any, options?: any): Promise<any>
  put(url: string, body?: any, options?: any): Promise<any>
}
