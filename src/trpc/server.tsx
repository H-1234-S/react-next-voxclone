/* eslint-disable @typescript-eslint/no-explicit-any */
import 'server-only'; // <-- ensure this file cannot be imported from the client
import { 
  createTRPCOptionsProxy, 
  TRPCQueryOptions
} from '@trpc/tanstack-react-query';
import { cache } from 'react';
import { createTRPCContext } from './init';
import { makeQueryClient } from './query-client';
import { appRouter } from './routers/_app';
import { 
  dehydrate, 
  HydrationBoundary
} from '@tanstack/react-query';
// IMPORTANT: Create a stable getter for the query client that
//            will return the same client during the same request.
export const getQueryClient = cache(makeQueryClient);

export const trpc = createTRPCOptionsProxy({
  ctx: createTRPCContext,
  router: appRouter,
  queryClient: getQueryClient,
});
// If your router is on a separate server, pass a client:
// createTRPCOptionsProxy({
//   client: createTRPCClient({
//     links: [httpLink({ url: '...' })],
//   }),
//   queryClient: getQueryClient,
// });

export function HydrateClient(props: { children: React.ReactNode }) {
  const queryClient = getQueryClient();
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {props.children}
    </HydrationBoundary>
  );
};


// 预取函数，接受一个 trpc 查询选项对象，根据它的类型调用不同的预取方法
export function prefetch<T extends ReturnType<TRPCQueryOptions<any>>>(
  queryOptions: T,
) {
  const queryClient = getQueryClient();
  // 如果查询选项的第二个元素（通常是查询类型）是 'infinite'，则调用 prefetchInfiniteQuery 方法，否则调用 prefetchQuery 方法
  if (queryOptions.queryKey[1]?.type === 'infinite') {
    void queryClient.prefetchInfiniteQuery(queryOptions as any);
  } else {
    // void 关键字用于告诉 TypeScript 我们知道这个函数返回一个 Promise，但我们不需要处理它的结果（比如等待它完成或捕获错误）。这在预取数据时很常见，因为我们通常不关心预取操作的结果，只需要触发它即可。
    void queryClient.prefetchQuery(queryOptions);
  }
}