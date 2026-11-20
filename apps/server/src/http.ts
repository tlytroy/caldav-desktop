import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * 把 async handler 的 rejection 交给 Express 错误中间件。
 *
 * 为什么必须有这一层：Express 4 只认同步 throw，`async` 函数返回的 rejected
 * Promise 不会被自动转交。结果是：
 *  - Node ≥ 15 把未处理 rejection 当成致命错误，**整个进程退出**；
 *  - 客户端侧表现为请求一直挂着，用户看不到任何错误。
 *
 * 这个模块单独存在（而不是放在 app.ts）是为了避免 `app.ts → routes → app.ts`
 * 的循环依赖：路由在模块求值阶段就要调用 `asyncHandler`。
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    void Promise.resolve(fn(req, res, next)).catch(next);
  };
}
