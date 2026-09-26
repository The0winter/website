import Link from 'next/link';

export default function UserNotFound() {
  return <main className="mx-auto max-w-xl px-6 py-20 text-center"><h1 className="text-xl font-semibold">书友主页暂不可用</h1><p className="mt-3 text-gray-500">该账号不存在或暂时无法访问。</p><Link className="mt-6 inline-block underline" href="/">返回书库</Link></main>;
}
