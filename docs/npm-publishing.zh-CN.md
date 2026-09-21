# 发布 `@vow132/pi-web` 到 npm

本仓库的 `custom` 分支已配置为公开 npm scoped package：

- 包名：`@vow132/pi-web`
- 全局命令：`pi-web`
- npm registry：`https://registry.npmjs.org/`
- 最低 Node.js 版本：`22.19.0`

## 首次发布

`@vow132` 必须是你的 npm 用户名，或是你拥有发布权限的 npm Organization。如果你的 npm 用户名不是 `vow132`，请先创建同名 Organization，或把仓库里的 scope 改成你的实际 npm scope。

在 `custom` 分支的仓库根目录执行：

```bash
git switch custom
npm login --registry https://registry.npmjs.org/
npm whoami --registry https://registry.npmjs.org/
npm ci
npm test
npm run lint
npx tsc --noEmit
npm run build
npm pack --dry-run
npm publish --access public --registry https://registry.npmjs.org/
```

`npm whoami` 应输出 `vow132`，或输出对 `@vow132` Organization 有发布权限的账号。直接发布需要 npm 账号启用双重验证（2FA），或使用允许发布的 granular access token。

首次发布成功后验证：

```bash
npm view @vow132/pi-web version --registry https://registry.npmjs.org/
npm install -g @vow132/pi-web@latest --registry https://registry.npmjs.org/
pi-web --help
```

不指定 `--tag` 的 `npm publish` 会把本次版本设置为 `latest`，因此其他人可以执行：

```bash
npm install -g @vow132/pi-web@latest
pi-web
```

## 后续发布

仓库的 `release` 脚本会把 patch 版本加一、构建项目并发布：

```bash
npm run release
```

发布后提交版本号变化，并创建同版本 Git tag：

```bash
git add package.json package-lock.json
git commit -m "Release v<version>"
git tag -a v<version> -m "v<version>"
git push origin custom --tags
```

完整的 GitHub Release 流程见 [`docs/release.md`](./release.md)。

## 常见错误

- `E404` 或 `ENEEDAUTH`：确认登录的是官方 registry，并检查 `npm whoami`。
- `E403`：确认 `@vow132` 是你的 npm scope、账号具有发布权限，并已满足 2FA 要求。
- `EPUBLISHCONFLICT`：同一包名下的同一版本不能重复发布；先提升 `package.json` 的版本。
- 安装后没有 `pi-web` 命令：确认 Node.js 版本满足要求，并检查 npm 的全局 bin 目录是否在 `PATH` 中。

