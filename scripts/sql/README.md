# SQL 初始化说明

本目录存放 Open Shop 模板的关系型数据库 schema 和示例数据。

## 数据库

默认数据库/schema：

```text
vibe_shop
```

正式环境可通过云函数环境变量 `OPEN_SHOP_DATABASE` 覆盖默认数据库名。

## 文件

- `init.sql`：核心表结构。
- `seed.sql`：示例商品和演示数据，不包含私有管理员 OPENID。

## 云函数连接方式

优先使用 CloudBase Node SDK 的关系型数据库能力：

```js
getApp().rdb({ database: process.env.OPEN_SHOP_DATABASE || process.env.MYSQL_DATABASE || 'vibe_shop' })
```

正式环境建议设置 `OPEN_SHOP_DATABASE` 云函数环境变量。

## 管理员绑定

`vibe_admins.openid` 用于小程序端商家管理入口，`vibe_admins.web_uid` 用于 Web 后台登录权限。创建首个管理员时，可在项目根目录运行：

```sh
npm run admin:bind-sql -- --openid 管理员OPENID --web-uid 后台用户UID
```

脚本会输出一段 SQL，把它复制到 CloudBase 关系型数据库中执行。

## 控制台相关事项

部分数据库信息只能在腾讯云 / CloudBase 控制台确认：

- 关系型数据库是否已创建。
- 数据库账号和密码。
- VPC / 内网地址。
- 权限和网络访问配置。

这些信息不应写入公开仓库，也不应提交到 Git。
