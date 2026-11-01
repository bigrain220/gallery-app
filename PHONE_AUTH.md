# 后端 AI 实现任务：微信小程序授权手机号回填

## 给执行 AI 的指令

请直接在当前后端仓库实现以下功能，并完成测试、配置说明和交付总结。先阅读仓库的 AGENTS.md 及现有 TF 模块代码，遵循现有架构、命名、响应封装和异常处理规范。不要只输出方案或示例代码；请修改实际源码。本文定义的前端接口契约必须保持一致。若仓库现状与下面的背景不同，以实际源码为准调整内部实现，并说明差异，不要擅自更改对外契约。

## 目标与已有前端

预约表单已增加微信原生手机号授权按钮：

```xml
<button open-type="getPhoneNumber" bindgetphonenumber="onGetPhoneNumber">
  微信授权填入
</button>
```

用户主动点击并同意授权后，前端取得 `event.detail.code`，调用本文接口，把返回的 `purePhoneNumber` 回填到预约手机号输入框。拒绝授权不发请求；失败保留原值，允许重新授权或手动输入。前端仅接受中国大陆手机号：`countryCode` 转为字符串后等于 `86`，`purePhoneNumber` 匹配 `^1[3-9]\d{9}$`。

本任务仅实现授权 code 换取手机号，不创建预约、不登录、不签发 token、不自动绑定用户、不修改已有预约信息，不需要新增数据库表。

## 项目背景与定位线索

根据现有移动端接口清单，后端为 `yudao-boot-mini-master`，保留 infra / system / tf 模块，使用 Java / Spring 及芋道框架。请在实际仓库确认以下位置：

- TF 模块 `controller.app` 下的 `AppBookingController` 或同类预约 Controller。
- 现有 `/tf/booking/create`、`/tf/booking/get-by-openid` 的服务、响应封装、错误码及限流方式。
- App Controller 由框架自动添加 `/app-api` 前缀；不要在 Controller 中重复添加。
- 当前小程序通过 `wx.cloud.callContainer` 访问云托管服务 `tf`，请求包含 `tenant-id: 1`。身份通过云托管网关注入的 `X-WX-OPENID` 获取，沿用现有可信身份读取方式；不要信任请求体自行传入的 openid。
- TF 现有接口免业务登录。新接口沿用现有安全框架的免登录接入方式，不新增用户 token 要求；身份校验和防刷沿用可信网关及项目现有机制。

这些是定位线索，不要求创建同名类或重复造已有基础设施。

## 必须实现的接口契约

### 请求

`POST /app-api/tf/booking/phone-number`

```http
Content-Type: application/json
tenant-id: 1
```

```json
{
  "code": "微信 getPhoneNumber 授权回调返回的动态 code"
}
```

`code` 为必填非空字符串。使用项目现有参数校验方式拒绝缺失、空白和非法类型；不要把它当作手机号，也不要把它当作 `wx.login` 返回的登录 code。

### 成功响应

使用项目现有统一响应封装，JSON 必须兼容：

```json
{
  "code": 0,
  "data": {
    "purePhoneNumber": "13800138000",
    "countryCode": "86"
  },
  "msg": ""
}
```

`purePhoneNumber` 必须是字符串，不含国家区号；`countryCode` 建议统一输出字符串。上面的号码仅为测试示例，严禁在生产代码中伪造成功响应。不要把微信的整个响应透传给前端。

### 失败响应

遵循现有 HTTP 状态和统一业务异常约定，业务 `code` 必须非 0，`msg` 为可理解的信息。覆盖参数错误、授权 code 无效/过期/已使用、微信接口失败或超时、凭据配置缺失、上游响应不完整、不支持的手机号。不要将微信错误响应包装成 `code: 0`，不要向前端返回 access_token、AppSecret 或原始堆栈。

## 服务端微信调用流程

1. 校验请求和现有接入身份，执行限流后，再调用微信。
2. 查找并优先复用项目已有的小程序配置、微信 SDK、access_token 获取和缓存服务。必须使用与当前前端小程序匹配的 AppID 对应的 token，不能混用公众号或其他小程序凭据。多租户项目遵循现有配置隔离方式。
3. 使用该小程序的 access_token 调用微信接口：

```http
POST https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=ACCESS_TOKEN
Content-Type: application/json
```

```json
{"code":"前端传来的授权 code"}
```

4. 检查微信业务结果并读取 `phone_info.purePhoneNumber` 和 `phone_info.countryCode`，校验字段存在且符合前端支持范围，再转换为本文成功响应。
5. code 是短期、一次性兑换凭证。不要缓存 code 或兑换结果，不做后台排队兑换，不重放已消费的 code。网络超时后可能已消费，不盲目重试兑换；向前端返回错误，让用户重新点击授权。若已有 SDK 包含重试，检查是否可能重放兑换请求。
6. token 缓存应按微信返回有效期提前失效，避免每次取号都重新获取 token；并发刷新使用现有锁机制。token 失效时只允许按微信明确的错误语义做受控刷新处理，避免无限刷新或重试。

不需要通过 `code2session` 换取手机号，也不需要前端提供 `encryptedData`、`iv`、`session_key` 或再调用 `wx.login`。

执行前请核对微信官方最新文档，确认具体 SDK/API 参数、token 方案、有效期及错误码，不要凭记忆编造错误码：

- [手机号快速验证组件](https://developers.weixin.qq.com/miniprogram/dev/framework/open-ability/getPhoneNumber.html)
- [服务端获取手机号接口](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/user-info/phone-number/getPhoneNumber.html)

## 配置、安全与部署要求

- AppID、AppSecret 通过项目配置中心或环境变量注入，提交占位配置和说明，不提交真实密钥。已有微信凭据服务可复用时，不另加重复配置。
- 使用项目现有 HTTP 客户端或 SDK，设置有限连接/读取超时，保持 HTTPS 证书校验。
- 沿用现有限流机制，优先按可信微信身份限制频率，并结合项目现有 IP 防刷方式；说明最终采用的阈值和键。
- 禁止在请求日志、HTTP 客户端日志、异常日志中记录完整授权 code、手机号、AppSecret 或 access_token；检查通用请求体日志是否需要对此接口脱敏。
- 不为本功能额外持久化手机号；预约仍由用户确认提交现有接口。
- 部署说明中列出实际配置项、微信后台手机号能力开通、可用额度/计费状态确认、隐私保护指引配置及云托管身份注入配置。后台操作由维护者完成，缺少真实凭据时仍须完成可测试的代码，不伪称已真机联通。

## 测试与验收

按仓库现有测试框架添加有意义的测试，模拟微信上游，禁止用真实凭据或真实手机号发起收费调用。

至少覆盖：

1. 有效 code：校验上游请求路径、方法、请求体，正确返回统一响应中的两个字段。
2. code 缺失、空白或类型不合法：请求被拒绝，不调用微信。
3. 微信返回 code 失效、已使用或其他业务错误：前端收到非 0 业务码，不回填假号码。
4. 微信网络超时/异常、响应缺少 phone_info 或字段异常：正确失败，不盲目重放兑换。
5. 不支持的国家区号或不合法大陆手机号：明确失败。
6. token 缓存和失效处理：复用现有服务时验证集成；自行实现时测试缓存命中、过期和并发刷新。
7. 免业务登录、租户与可信身份处理、限流符合现有接口规则；新接口不影响预约创建/查询。

联调验收：真机点击授权 → 前端收到动态 code → 本接口成功兑换 → 手机号自动回填 → 用户确认后可使用原预约接口提交。拒绝授权、接口失败、重新授权和手动输入均可正常操作。

## 最终交付给后端维护者

完成代码后，请报告：

- 修改的实际文件和实现方式。
- 最终请求/响应示例及新增业务错误码。
- 实际使用的配置项及部署步骤，注明哪些配置可复用。
- 执行的测试命令与结果。
- 尚需维护者完成的后台开通、凭据配置或真机联调事项。

不要只交付接口草案；在当前后端仓库完成实现。无法访问真实微信或缺少凭据时，明确区分“代码及模拟测试完成”与“真机联调完成”。
