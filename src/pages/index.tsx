export default function HomePage() {
  return (
    <div>
      <iframe
        style={{
          width: "100%",
          height: "calc(100vh - 65px)",
          border: "0",
          display: "block",
        }}
        src="https://lotto.sina.cn/trend/qxc_qlc_proxy.d.html?lottoType=dlt&actionType=chzs&0_ala_h5baidu&_headline=baidu_ala"
        title="综合走势图"
      />
    </div>
  );
}
