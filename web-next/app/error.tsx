'use client';
export default function ErrorPage({reset}:{reset:()=>void}) {
  return <div className="max-w-xl mx-auto p-8 text-center"><h1 className="text-xl mb-4">服务暂时不可用</h1><p>请稍后重试，阅读内容和账户数据不会因此清空。</p><button className="mt-4 px-4 py-2 rounded bg-blue-600 text-white" onClick={reset}>重新加载</button></div>;
}
