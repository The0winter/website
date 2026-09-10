import Image from 'next/image';

export default function AccountLoading({ checking }: { checking: boolean }) {
  return <div className="account-loading" role="status">
    <div><Image src="/icon.png" alt="" width={32} height={32} priority /><span>九天小说</span></div>
    <p>{checking ? '正在确认登录状态…' : '正在打开登录…'}</p>
  </div>;
}
