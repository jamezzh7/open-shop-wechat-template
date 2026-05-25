# Open Shop 模板自动化

本文档说明 Open Shop 如何从单店项目整理成可复用的小程序电商模板。文档只写中文，默认读者是国内微信小程序开发者、商家或运营人员。

## 仓库形态

- `miniprogram/` 是唯一的小程序源码目录。
- `cloudfunctions/` 存放 Open Shop 自己维护的 CloudBase 云函数。
- `admin-web/` 是商家运营后台，属于模板产品的一部分。
- `scripts/sql/` 存放数据库 schema 和示例数据。
- `scripts/bootstrap-shop.js` 根据店铺配置生成本地项目配置。
- `scripts/deploy-cloudfunctions.js` 根据 `cloudbaserc.json` 部署云函数。
- `scripts/print-admin-bind-sql.js` 生成首个管理员绑定 SQL。
- `shops/example.json` 是可复制的店铺配置样例。
- `docs/` 存放公开模板文档。

不再提交旧项目留下的上传副本目录。微信开发者工具直接打开项目根目录，`project.config.json` 指向 `miniprogram/`。

## 支付模板

仓库不再提交 `cloudfunctions/wxpayFunctions/` 本地源码。

使用微信支付时，需要在微信云开发 / CloudBase 控制台安装并配置微信支付云模板。模板代码中仍然会调用部署后的支付能力：

- 小程序端下单支付会调用 `wxpayFunctions`，并传入 `type: 'wxpay_order'`。
- 退款逻辑会通过 `cloudbase_module` 调用 `wxpay_refund`。

新项目初始化时应检查：

- 微信支付商户号已绑定。
- 支付云模板已安装到当前 CloudBase 环境。
- 支付回调能触达 `vibe_pay_callback` 或当前项目配置的回调处理函数。
- 退款权限和证书配置已完成。

## 客户初始化目标

目标客户流程尽量压缩成：

1. 复制 `shops/example.json` 为本地私有配置，例如 `shops/client.local.json`。
2. 填写小程序 appid、CloudBase 环境、店铺名称、品牌色、功能开关等必要字段。
3. 运行：

```sh
npm run bootstrap:shop -- shops/client.local.json
```

4. 在微信开发者工具中打开项目根目录，完成预览、真机测试、上传和审核。

脚本会生成：

- `project.config.json`
- `cloudbaserc.json`
- `miniprogram/app.json`
- `miniprogram/config/shop.js`
- `admin-web/.env.local`

## 云函数部署

本模板后端基于微信云开发 / CloudBase。客户创建自己的 CloudBase 环境后，需要把 `cloudfunctions/` 下的业务云函数上传到自己的环境中。

先预览部署命令：

```sh
npm run deploy:functions -- --dry-run
```

确认无误后执行：

```sh
npm run deploy:functions
```

只部署某几个云函数：

```sh
npm run deploy:functions -- --only vibe_catalog,vibe_createOrder
```

部署前应确认：

- 已安装并登录 CloudBase CLI / `tcb`。
- 已运行 `npm run bootstrap:shop -- shops/client.local.json`。
- `cloudbaserc.json` 的 `envId` 是客户自己的 CloudBase 环境。
- 关系型数据库和必要权限已经在云开发控制台配置完成。
- 云函数环境变量已按需配置：
  - `OPEN_SHOP_DATABASE`：关系型数据库名，默认 `vibe_shop`。
  - `OPEN_SHOP_NAME`：店铺名称，用于通知和默认自提名称。
  - `ORDER_NOTIFY_WEBHOOK_URL`：企业微信订单通知 webhook，按需配置。
- 支付云模板已在云开发控制台安装并配置完成。

## 后台处理方式

后台保留在模板仓库中，并随同一份店铺配置初始化。

- 后台品牌名通过 `VITE_SHOP_NAME` 配置。
- 后台 CloudBase 环境通过 `VITE_CLOUDBASE_ENV_ID` 配置。
- 本地后台配置写入 `admin-web/.env.local`。
- 公开仓库提交 `admin-web/.env.example` 作为变量示例。
- 后续部署应由脚本执行 `npm run build` 并上传 `admin-web/dist` 到 CloudBase 静态托管，例如 `/admin`。

首个后台管理员需要在 CloudBase 控制台创建 Web 用户后绑定 UID。项目提供 `npm run admin:bind-sql` 生成 SQL，避免手工拼写字段。

## 后续自动化计划

已经完成：

- 移除旧项目留下的上传副本目录。
- 移除本地微信支付模板源码，改为文档说明安装云开发支付模板。
- 增加 `shops/example.json`。
- 增加 `scripts/bootstrap-shop.js`。
- 增加 `scripts/deploy-cloudfunctions.js`。
- 增加 `scripts/print-admin-bind-sql.js`，用于生成首个管理员绑定 SQL。
- 后台改为读取环境变量。
- 小程序页面统一读取 `miniprogram/config/shop.js` 中的店铺名、分享标题、支付描述、自提默认名和客服字段。
- 云函数统一改为从环境变量读取数据库名、店铺名和通知 webhook，避免绑定原始店铺环境。
- SQL schema 增加 `vibe_admins.web_uid`，后台 Web 登录权限与 CloudBase 用户 UID 对齐。

后续建议继续做：

1. SQL seed 拆成通用示例数据和私有商家数据。
2. 增加 SQL 初始化命令。
3. 完善云函数部署命令，支持环境检查和失败重试提示。
4. 增加后台静态托管部署命令。
5. 增加配置检查命令，输出缺失项和控制台待办。

## 不强行自动化的事项

以下事项涉及微信/腾讯账号、扫码或敏感凭证，脚本只生成检查清单，不应试图绕过：

- 微信小程序注册和 appid 创建。
- 微信开发者工具扫码登录、上传和提交审核。
- 微信支付商户号绑定、证书、支付模板和回调配置。
- 订阅消息模板选择。
- 企业微信群机器人 webhook 创建。
