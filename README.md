
## Custom Voice Process

自定义语音存在两种语音上传方式，一种是**上传音频文件**，另一种是**录音上传**，其实都是基于recordRTC实现的

**录音上传流程：**
```
用户点击录制按钮，其实是调用startRecording函数

在函数获取麦克风权限、中对recordRTC初始化，调用recorder.startRecording方法开始录音

当用户点击暂停时，也就是调用stopRecording函数

在函数中调用recorder.stopRecording方法暂停录音，调用recorder.getBlob方法获取类型为audio/wav的blob对象

	blob 代表一段二进制数据，可以是任何东西的二进制形式
	file 是 blob 的特殊形式，也是对 blob 的拓展，目的是使其能够表现为一个操作系统中的文件
	new File 可以将 Blob 转为 File

将 blob 转为 file 之后，使用 tanstack form 管理表单数据

如果用户选择完其他参数，点击提交后，向/api/voices/create发送请求，将基本的参数用查询参数传递，file作为body发送

	也可以使用formData上传，但是解析需要用 request.formData() 来解析

在route中进行基本的鉴权操作，safeParse数据，request.arrayBuffer 处理二进制数据

对二进制数据进行大小校验、时长校验，时长校验使用了music-metadata库

之后就需要将文件上传到 cloudflare 中，但是在 cloudflare 中使用 voices/orgs/${orgId}/${voice.id} 这种格式上传数据

因此需要先使用 prisma.voice.create 生成一个占位符，获取 voiceId

之后调用 uploadAudio 函数上传音频数据，同时将 r2ObjectKey 补充到表中

	对于 cloudflare 的应用，其实也就是初始化r2，之后上传数据、删除数据、获取一个临时的url链接用来预览音频
```

## Audio Generation Process

```
用户在 tts 页面输入文本，选择音色，调整对应参数，点击生成之后

首先 tanstack form 管理表单数据，点击生成提交表单数据到 onSubmit 函数中进行处理

onSubmit 函数中使用了 tanstack query 的 mutation 函数处理请求

同时 tanstack query 与 tRPC 进行集成
	
	因为使用 tRPC 获取的数据本质上还是 server state，拿到的其实是后端数据
	tRPC 是让你类型安全的调用服务端程序，类型安全的获取后端数据
	Tanstack Query 则是类型安全的对服务端状态进行管理

使用 createMutation 携带参数到 trpc.generations.create 程序执行

在 procedure 中对数据基本验证、鉴权，根据 voiceId 查找对应的 r2ObjectKey

调用 chatterbox.POST 传入 r2ObjectKey，Chatterbox 后端根据 r2ObjectKey 去加载对应的参考音频，根据 prompt 生成新的音频

	chatterbox.POST("/generate", ...)
	它会向环境变量 CHATTERBOX_API_URL 指向的 Modal 平台上的 Chatterbox 服务发送 HTTP 请求
	而这个 Modal 服务就是由根目录的 chatterbox_tts.py 部署出来的

返回的数据是 web 标准的 ArrayBuffer 原始二进制数据

对于返回的 generation 音频，上传到 cloudflare 中，用于生成一个预览url，便于前端展示

响应成功后携带 generationId 跳转到生成音频详情页

跳转到生成详情页，根据对应 generationId 预取对应数据
	
	预取数据，服务端将数据脱水后传递到客户端，客户端再将数据水合

调用 useSuspenseQueries 直接命中缓存，从缓存中获取数据

对数据进行渲染就好了，在这里实现了音频波形可视化，用到了一个第三方库叫 wavesurfer.js

```
## tRPC

tRPC，全称 TypeScript Remote Procedure Call。它让**前端**像调用本地函数一样调用**服务端 Procedure**，同时把输入、输出、错误类型从服务端路由自动推导到客户端。
### 核心概念

**Router**

其实就是在 approuter 中将多个 procedure 组合到一起，然后导出 approuter type

``` js
// 1. 定义子路由
const userRouter = t.router({
  getById: t.procedure.query(() => { ... }),
});

// 2. 合并成根路由 (AppRouter)
export const appRouter = t.router({
  user: userRouter, // 挂载为 user 子模块
});

export type AppRouter = typeof appRouter; // 核心：只导出类型
```

**Procedure**

procedure 其实就是前端调用后，在后端执行的业务逻辑，也就是每一个具体的接口

主要分为三种类型：

- **Query**：用于**获取数据**（对应 HTTP GET），它会被 Tanstack Query 缓存
    
- **Mutation**：用于**创建、更新、删除数据**（对应 HTTP POST/PUT/DELETE）
    
- **Subscription**：用于**实时双向通信**（基于 WebSocket）

**Context**

context 是每次请求共享的运行环境，每个请求至少会调用 createTRPCContext 函数一次，但是通常都会将 createTRPCContext 包一层 cache，如果同一请求调用多次时会使用缓存

**Middleware**

middleware 其实是在每次 procedure 执行前都会调用一次，通常可以用来鉴权等操作

``` js
// 1. 公开的过程，谁都能调
export const publicProcedure = t.procedure;

// 2. 强力中间件：检查登录状态，并把 user 注入到 ctx 中
const isAuthed = t.middleware(({ ctx, next }) => {
  if (!ctx.session?.user) {
    throw new TRPCError({ code: 'UNAUTHORIZED' });
  }
  return next({
    ctx: { user: ctx.session.user }, // 覆盖并增强 ctx 的类型！
  });
});

// 3. 生产出一个“受保护的过程”
export const protectedProcedure = t.procedure.use(isAuthed);

// 使用时：这里的 ctx.user 100% 存在且带有强类型，免去去写 if(!user) 的痛苦
protectedProcedure.query(({ ctx }) => {
  return ctx.user.secretData; 
});
```

**Data Transformers**

因为传统的 JSON api 只能传字符串，没有`Date`、`Map`、`Set`等类型，例如你从数据库查出一个 `Date` 对象，经过网络传输变成 JSON 后，前端收到的就变成了一个 `string`，不得不手动 `new Date(dateStr)`

但是 tRPC 通过集成 superjson，可以在后端发送前，自动将 `Date`、`Map`、`Set`、`BigInt`、`RegExp` 等复杂 JavaScript 对象序列化；在前端接收到时，自动还原成对应的原生对象。

---
### 执行流程

用 generations.create 举例，前端调用 trpc.generations.create.mutate，后端执行对应的 create: orgProcedure.input(...).mutation(...)

**完整链路：**
```
前端调用 trpc.generations.create.mutate(...)

	使用useTRPC获取的trpc实例其实就是从context中获取trpcClient，在trpc/client.tsx中初始化并注入到react组件树中
	trpcClient中使用httpBatchLink工具合并了短时间内多次请求，并根据不同的环境生成请求地址，同时还对数据序列化处理

请求最终会打到 /api/trpc/generations.create 中，执行 route handle，也就是调用 fetchRequestHandler(fetch请求适配器)

fetchRequestHandler 用来把来自 fetch 标准接口的请求转换成 tRPC 能处理的调用

	接收 HTTP 请求
	解析 tRPC 请求内容，例如 procedure 名称、input 参数等
	会调用 createTRPCContext 创建执行上下文
	去 appRouter 里找对应 procedure 执行
	把结果包装成 HTTP Response

前端请求的是 generations.create，会先在 approuter 里寻找 generations: generationsRouter，再在 generationsRouter 找到 create

之后执行对应的 procedure前先执行 procedure middleware，可以在 middleware 中修改 ctx

再之后就到了对前端传递的数据进行校验，也就是执行 input
	
	其实前端链式调用时会被trpc映射为请求，所以相当于发送请求
	只要是请求就可以被伪造，别人发到 /api/trpc/[trpc] 的请求也可以执行，首先在middleware中对身份校验、之后在input中对参数校验

通过校验后就会进入到 query/mutation 中执行业务逻辑

最后的返回结果 trpc 会将结果序列化为 HTTP Response
```

架构设计
## Tanstack Query

Tanstack Query 是一个用于管理**服务端状态**的异步状态管理库。它不负责发送请求，依旧可以使用 `fetch`、`axios`、`ky` 或使用 `tRPC` 请求数据

它真正解决的是：请求结果如何缓存、什么时候重新请求、多个组件如何共享同一份数据、失败如何重试、修改数据后如何同步界面。

核心概念

执行流程

架构设计

## Tanstack Form

是什么？

解决了什么问题？

基本语法

demo

核心概念

坑与约束

执行流程

底层原理

架构设计
## Prisma

是什么？

解决了什么问题？

基本语法

demo

核心概念

坑与约束

执行流程

底层原理

架构设计


## Wavesurfer


## RecordRTC
