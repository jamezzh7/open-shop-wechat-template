# Open Shop 微信小程序电商模板

Open Shop 是一个基于微信原生小程序和 CloudBase 的电商模板，适合做点单、商品售卖、配送/自提、订单管理和商家后台。

本项目文档面向中文使用场景编写。

## 功能

- 微信原生小程序：WXML / WXSS / JS。
- CloudBase 云函数后端。
- SQL 数据库 schema 和示例数据。
- 商品、SKU、订单、配送、自提和会员储值能力。
- React/Vite 商家管理后台。
- 店铺配置驱动的初始化脚本。

## 快速开始

复制店铺配置示例：

```sh
cp shops/example.json shops/client.local.json
```

编辑 `shops/client.local.json`，填写小程序 appid、CloudBase 环境、店铺名称等信息。

生成本地配置：

```sh
npm run bootstrap:shop -- shops/client.local.json
```

脚本会生成：

- `project.config.json`
- `cloudbaserc.json`
- `miniprogram/app.json`
- `miniprogram/config/shop.js`
- `admin-web/.env.local`

然后用微信开发者工具打开项目根目录，进行预览、真机测试、上传和审核。

## 后端和云函数

本模板后端基于微信云开发 / CloudBase。客户创建自己的 CloudBase 环境后，需要把 `cloudfunctions/` 下的业务云函数上传到自己的环境中。

先预览将要部署的云函数：

```sh
npm run deploy:functions -- --dry-run
```

确认环境 ID 和函数列表无误后执行：

```sh
npm run deploy:functions
```

只部署某几个云函数：

```sh
npm run deploy:functions -- --only vibe_catalog,vibe_createOrder
```

执行部署前需要确认本机已经安装并登录 CloudBase CLI / `tcb`，且 `cloudbaserc.json` 中的 `envId` 是客户自己的云开发环境。

微信支付云模板不在本仓库中提交。需要在云开发控制台安装并配置微信支付云模板，代码会调用部署后的支付模板能力。

建议在云函数环境变量中配置：

| 变量 | 说明 |
| --- | --- |
| `OPEN_SHOP_DATABASE` | 关系型数据库名，默认 `vibe_shop` |
| `OPEN_SHOP_NAME` | 店铺名称，用于订单通知和默认自提名称 |
| `ORDER_NOTIFY_WEBHOOK_URL` | 企业微信订单通知 webhook，按需配置 |

如果不配置，云函数会使用模板默认值，但正式店铺建议按客户环境补齐。

## 后台管理员

后台登录使用 CloudBase Web 用户，商家小程序管理入口使用微信小程序 OPENID。创建首个管理员时，先在 CloudBase 控制台创建后台登录用户，并获取该用户 UID；如果还需要小程序端商家管理入口，再获取管理员微信 OPENID。

生成管理员绑定 SQL：

```sh
npm run admin:bind-sql -- --openid 管理员OPENID --web-uid 后台用户UID
```

只需要后台管理时可以只传 `--web-uid`；只需要小程序端商家管理入口时可以只传 `--openid`。把脚本输出的 SQL 复制到 CloudBase 关系型数据库中执行即可。

## 目录

| 目录 | 说明 |
| --- | --- |
| `miniprogram/` | 小程序源码 |
| `cloudfunctions/` | CloudBase 云函数 |
| `admin-web/` | 商家管理后台 |
| `scripts/sql/` | 数据库 schema 和示例数据 |
| `scripts/bootstrap-shop.js` | 店铺初始化脚本 |
| `scripts/deploy-cloudfunctions.js` | 云函数部署辅助脚本 |
| `scripts/print-admin-bind-sql.js` | 管理员绑定 SQL 生成脚本 |
| `shops/example.json` | 店铺配置示例 |
| `docs/` | 模板文档 |

## 仍需手动完成的事项

有些事情涉及微信/腾讯账号、扫码或敏感凭证，不能完全自动化：

- 注册微信小程序并获取 appid。
- 微信开发者工具扫码登录、上传和提交审核。
- 上传 `cloudfunctions/` 下的业务云函数到客户自己的 CloudBase 环境。
- 在云函数环境变量中确认店铺名、数据库名和通知 webhook。
- 在云开发控制台安装并配置微信支付云模板。
- 配置微信支付商户号、证书、回调和支付权限。
- 创建首个后台用户并执行管理员绑定 SQL。
- 选择订阅消息模板。
- 创建企业微信群机器人 webhook。
