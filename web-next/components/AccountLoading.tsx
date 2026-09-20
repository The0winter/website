import {LoadingLogo, LoadingText} from './BrandLoading';

export default function AccountLoading({ checking }: { checking: boolean }) {
  return <div className="account-loading" role="status">
    <div><LoadingLogo/><span>九天小说</span></div>
    <p><LoadingText>{checking ? '正在确认登录状态' : '正在打开登录'}</LoadingText></p>
  </div>;
}
