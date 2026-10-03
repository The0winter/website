# 原生访客合同

`POST /api/v1/visitor`，JSON `{}`，无 Cookie/Origin/Sec-Fetch-Site，返回 `visitorToken,expiresAt`。服务端每 IP 每分钟最多10次；token有效90天，独立issuer/audience/type签名，不能当账号Bearer使用。

App 持久保存 token，业务请求携带 `X-Native-Visitor`。读取同一访客的社区偏好，写入现有访客可执行的推荐反馈/设置/事件、书籍及帖子阅读回执。服务端仅对精确路径与方法给予此类请求CSRF例外，账号/创作/管理仍要求真正登录，网页保护不变。登录后的账号身份优先于访客。

HTTP401 `VISITOR_EXPIRED`/`VISITOR_INVALID` 允许申请一次新访客token并重新发送原请求；它们不是账号会话撤销，不应清理用户登录。更换访客token会创建新的匿名偏好身份，正常启动不应每次申请新token。

客户端不能保存或回传服务端浏览器cookie。离线保留token和本地偏好；网络失败显示可重试状态，不伪造服务端已保存。
