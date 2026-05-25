# 商家管理后台

这是 Open Shop 模板自带的 Web 管理后台，用于商家管理商品、订单、运费/自提配置和经营看板。后台是模板产品的一部分，应跟随店铺配置自动初始化和部署。

## 本地配置

复制环境变量示例：

```sh
cp .env.example .env.local
```

或在项目根目录运行：

```sh
npm run bootstrap:shop -- shops/client.local.json
```

脚本会根据店铺配置生成 `admin-web/.env.local`。

## 常用命令

```sh
npm install
npm run build
```

开发调试可使用：

```sh
npm run dev
```

## 关键环境变量

| 变量 | 说明 |
| --- | --- |
| `VITE_SHOP_NAME` | 后台显示的店铺名称 |
| `VITE_CLOUDBASE_ENV_ID` | CloudBase 环境 ID |
| `VITE_CLOUDBASE_REGION` | CloudBase 地域，默认 `ap-shanghai` |
| `VITE_CLOUDBASE_ACCESS_KEY` | Web 端 CloudBase 访问配置，按实际 auth 方案填写 |

## 首个管理员

后台登录用户需要先在 CloudBase 控制台创建，并把该用户 UID 绑定到 `vibe_admins.web_uid`。可在项目根目录生成绑定 SQL：

```sh
npm run admin:bind-sql -- --web-uid 后台用户UID
```

如果同一个人也要使用小程序端商家管理入口，可以同时绑定微信 OPENID：

```sh
npm run admin:bind-sql -- --openid 管理员OPENID --web-uid 后台用户UID
```

把脚本输出的 SQL 复制到 CloudBase 关系型数据库中执行。

## 部署方向

后台构建产物位于 `admin-web/dist/`，该目录不进入 Git。后续自动化脚本应将它部署到 CloudBase 静态托管，例如 `/admin`。
