import { useMemo, useState, useEffect } from "react";
import { Row, Col, Form, InputNumber, Select, Button, Space, Table, Alert, Tooltip } from "antd";
import { QuestionCircleOutlined } from "@ant-design/icons";
import { Line, Heatmap, Column } from "@ant-design/plots";
import useObjectState from "@/hooks/useObjectState";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import tempData from "data/temp_all_history_data.json";

type Period = { 期数: string; 蓝球: string };
type BluePeriod = { 期数: string; 蓝: number[] };

const nums = Array.from({ length: 12 }, (_, i) => i + 1);

const parseBluePeriods = (data: Period[]): BluePeriod[] => {
  const arr = data.slice(-50).map((d) => {
    const blues = d["蓝球"].split(" ").map((n) => Number(n)).filter((n) => n >= 1 && n <= 12);
    return { 期数: d["期数"], 蓝: blues.slice(0, 2) };
  });
  return arr;
};

const freqMap = (periods: BluePeriod[], window: number) => {
  const start = Math.max(0, periods.length - window);
  const map: Record<number, number> = {};
  nums.forEach((n) => (map[n] = 0));
  for (let i = start; i < periods.length; i++) {
    periods[i].蓝.forEach((b) => (map[b] += 1));
  }
  const max = Math.max(...Object.values(map), 1);
  const norm: Record<number, number> = {};
  nums.forEach((n) => (norm[n] = map[n] / max));
  return { raw: map, norm };
};

const lastIntervals = (periods: BluePeriod[], window: number) => {
  const start = Math.max(0, periods.length - window);
  const lastIndex: Record<number, number> = {};
  nums.forEach((n) => (lastIndex[n] = -1));
  for (let i = start; i < periods.length; i++) {
    periods[i].蓝.forEach((b) => (lastIndex[b] = i));
  }
  const intervals: Record<number, number> = {};
  nums.forEach((n) => {
    const idx = lastIndex[n];
    intervals[n] = idx === -1 ? window + 1 : periods.length - idx;
  });
  return intervals;
};

const intervalScore = (intervals: Record<number, number>, target: number, sigma: number, window: number) => {
  const scores: Record<number, number> = {};
  nums.forEach((n) => {
    const iv = Math.min(Math.max(intervals[n], 0), window + 1);
    const s = Math.exp(-Math.abs(iv - target) / Math.max(sigma, 1));
    scores[n] = s;
  });
  const max = Math.max(...Object.values(scores), 1);
  const norm: Record<number, number> = {};
  nums.forEach((n) => (norm[n] = scores[n] / max));
  return norm;
};

const neighborScore = (periods: BluePeriod[], window: number, neighborWindow: number) => {
  const start = Math.max(0, periods.length - Math.min(window, neighborWindow));
  const map: Record<number, number> = {};
  nums.forEach((n) => (map[n] = 0));
  for (let i = start; i < periods.length; i++) {
    periods[i].蓝.forEach((b) => {
      const prev = b - 1;
      const next = b + 1;
      if (prev >= 1) map[prev] += 1;
      if (next <= 12) map[next] += 1;
    });
  }
  const max = Math.max(...Object.values(map), 1);
  const norm: Record<number, number> = {};
  nums.forEach((n) => (norm[n] = map[n] / max));
  return { raw: map, norm };
};

const oddEvenScore = (ratio: string) => {
  const [odd, even] = ratio.split(":").map((v) => Number(v));
  const oddWeight = odd / Math.max(odd + even, 1);
  const evenWeight = even / Math.max(odd + even, 1);
  const scores: Record<number, number> = {};
  nums.forEach((n) => (scores[n] = n % 2 === 1 ? oddWeight : evenWeight));
  const max = Math.max(...Object.values(scores), 1);
  const norm: Record<number, number> = {};
  nums.forEach((n) => (norm[n] = scores[n] / max));
  return norm;
};

const sizeScore = (ratio: string) => {
  const [small, big] = ratio.split(":").map((v) => Number(v));
  const smallWeight = small / Math.max(small + big, 1);
  const bigWeight = big / Math.max(small + big, 1);
  const scores: Record<number, number> = {};
  nums.forEach((n) => (scores[n] = n <= 6 ? smallWeight : bigWeight));
  const max = Math.max(...Object.values(scores), 1);
  const norm: Record<number, number> = {};
  nums.forEach((n) => (norm[n] = scores[n] / max));
  return norm;
};

const hotColdScore = (freqRaw: Record<number, number>, preference: "balanced" | "hot" | "cold") => {
  const entries = Object.entries(freqRaw).map(([k, v]) => ({ n: Number(k), c: v }));
  entries.sort((a, b) => b.c - a.c);
  const hotSet = new Set(entries.slice(0, 4).map((e) => e.n));
  const coldSet = new Set(entries.slice(-4).map((e) => e.n));
  const scores: Record<number, number> = {};
  nums.forEach((n) => {
    if (preference === "hot") scores[n] = hotSet.has(n) ? 1 : 0.6;
    else if (preference === "cold") scores[n] = coldSet.has(n) ? 1 : 0.6;
    else scores[n] = hotSet.has(n) || coldSet.has(n) ? 0.9 : 0.8;
  });
  const max = Math.max(...Object.values(scores), 1);
  const norm: Record<number, number> = {};
  nums.forEach((n) => (norm[n] = scores[n] / max));
  return norm;
};

const normalizeWeights = (w: Record<string, number>) => {
  const sum = Object.values(w).reduce((s, v) => s + v, 0);
  const r: Record<string, number> = {};
  Object.keys(w).forEach((k) => (r[k] = w[k] / Math.max(sum, 1)));
  return r;
};

const WeilanFenxi = () => {
  const bluePeriods = useMemo(() => parseBluePeriods(tempData as Period[]), []);

  const defaultParams = {
    window: 30,
    candidate: 6,
    intervalTarget: 5,
    intervalSigma: 3,
    oddEven: "1:1",
    size: "1:1",
    hotCold: "balanced" as "balanced" | "hot" | "cold",
    neighborWindow: 5,
  };
  const savedParams = typeof window !== "undefined" ? localStorage.getItem("weilan_params") : null;
  const initialParams = savedParams ? { ...defaultParams, ...JSON.parse(savedParams) } : defaultParams;
  const [params, updateParams] = useObjectState<typeof defaultParams>(initialParams);

  const defaultWeights = {
    wFreq: 0.35,
    wInterval: 0.25,
    wNeighbor: 0.2,
    wOddEven: 0.1,
    wSize: 0.1,
    wHotCold: 0.2,
  };
  const savedWeights = typeof window !== "undefined" ? localStorage.getItem("weilan_weights") : null;
  const initialWeights = savedWeights ? { ...defaultWeights, ...JSON.parse(savedWeights) } : defaultWeights;
  const [weights, setWeights] = useObjectState<typeof defaultWeights>(initialWeights);

  const freq = useMemo(() => freqMap(bluePeriods, params.window), [bluePeriods, params.window]);
  const intervals = useMemo(() => lastIntervals(bluePeriods, params.window), [bluePeriods, params.window]);
  const intervalScoreNorm = useMemo(
    () => intervalScore(intervals, params.intervalTarget, params.intervalSigma, params.window),
    [intervals, params.intervalTarget, params.intervalSigma, params.window]
  );
  const neighbor = useMemo(
    () => neighborScore(bluePeriods, params.window, params.neighborWindow),
    [bluePeriods, params.window, params.neighborWindow]
  );
  const oddEven = useMemo(() => oddEvenScore(params.oddEven), [params.oddEven]);
  const size = useMemo(() => sizeScore(params.size), [params.size]);
  const hotCold = useMemo(() => hotColdScore(freq.raw, params.hotCold), [freq.raw, params.hotCold]);

  const computeScores = () => {
    const w = normalizeWeights(weights);
    const scores: Record<number, number> = {};
    nums.forEach((n) => {
      scores[n] =
        w.wFreq * (freq.norm[n] || 0) +
        w.wInterval * (intervalScoreNorm[n] || 0) +
        w.wNeighbor * (neighbor.norm[n] || 0) +
        w.wOddEven * (oddEven[n] || 0) +
        w.wSize * (size[n] || 0) +
        w.wHotCold * (hotCold[n] || 0);
    });
    const max = Math.max(...Object.values(scores), 1);
    const prob: Record<number, number> = {};
    nums.forEach((n) => (prob[n] = scores[n] / max));
    return prob;
  };

  const [result, setResult] = useState<{ candidates: number[]; pair: number[]; probs: Record<number, number> } | null>(null);
  const [bt, setBt] = useState<{ total: number; hitAtLeast1: number; hitBoth: number; candidateHit: number; avgDeviation: number } | null>(null);

  useEffect(() => { try { localStorage.setItem("weilan_params", JSON.stringify(params)); } catch {} }, [params]);
  useEffect(() => { try { localStorage.setItem("weilan_weights", JSON.stringify(weights)); } catch {} }, [weights]);
  useEffect(() => { if (result) { try { localStorage.setItem("weilan_result", JSON.stringify(result)); } catch {} } }, [result]);
  useEffect(() => { if (bt) { try { localStorage.setItem("weilan_backtest", JSON.stringify(bt)); } catch {} } }, [bt]);
  useEffect(() => { try { const r = localStorage.getItem("weilan_result"); if (r) setResult(JSON.parse(r)); const b = localStorage.getItem("weilan_backtest"); if (b) setBt(JSON.parse(b)); } catch {} }, []);

  const predict = () => {
    const probs = computeScores();
    const sorted = nums.map((n) => ({ n, p: probs[n] })).sort((a, b) => b.p - a.p).map((e) => e.n);
    const candidates = sorted.slice(0, params.candidate);
    const pair = sorted.slice(0, 2);
    setResult({ candidates, pair, probs });
  };

  const runBacktest = () => {
    const window = params.window;
    let total = 0;
    let hitAtLeast1 = 0;
    let hitBoth = 0;
    let candidateHit = 0;
    let deviations: number[] = [];
    for (let i = window; i < bluePeriods.length; i++) {
      const sub = bluePeriods.slice(0, i);
      const f = freqMap(sub, window);
      const ints = lastIntervals(sub, window);
      const intScore = intervalScore(ints, params.intervalTarget, params.intervalSigma, window);
      const neigh = neighborScore(sub, window, params.neighborWindow);
      const oe = oddEvenScore(params.oddEven);
      const sz = sizeScore(params.size);
      const hc = hotColdScore(f.raw, params.hotCold);
      const w = normalizeWeights(weights);
      const scores: Record<number, number> = {};
      nums.forEach((n) => {
        scores[n] =
          w.wFreq * (f.norm[n] || 0) +
          w.wInterval * (intScore[n] || 0) +
          w.wNeighbor * (neigh.norm[n] || 0) +
          w.wOddEven * (oe[n] || 0) +
          w.wSize * (sz[n] || 0) +
          w.wHotCold * (hc[n] || 0);
      });
      const max = Math.max(...Object.values(scores), 1);
      const sorted = nums.map((n) => ({ n, p: scores[n] / max })).sort((a, b) => b.p - a.p).map((e) => e.n);
      const candidates = sorted.slice(0, params.candidate);
      const pair = sorted.slice(0, 2);
      const actual = bluePeriods[i].蓝;
      total += 1;
      const anyHitPair = pair.some((n) => actual.includes(n));
      const anyHitCandidates = candidates.some((n) => actual.includes(n));
      const bothHit = pair.every((n) => actual.includes(n));
      if (anyHitPair) hitAtLeast1 += 1;
      if (bothHit) hitBoth += 1;
      if (anyHitCandidates) candidateHit += 1;
      const dev = Math.min(
        ...actual.map((a) => Math.min(...candidates.map((c) => Math.abs(c - a))))
      );
      deviations.push(dev);
    }
    const avgDeviation = deviations.length ? deviations.reduce((s, v) => s + v, 0) / deviations.length : 0;
    setBt({ total, hitAtLeast1, hitBoth, candidateHit, avgDeviation });
  };

  const optimizeWeights = () => {
    const base = { ...weights };
    let best = { ...weights };
    let bestScore = -1;
    const evalBt = () => {
      return bt ? bt.candidateHit / Math.max(bt.total, 1) : 0;
    };
    const deltas = [0.1, -0.1];
    const keys = Object.keys(base);
    keys.forEach((k) => {
      deltas.forEach((d) => {
        const w = { ...base } as any;
        w[k] = Math.min(Math.max(w[k] + d, 0.01), 1);
        const norm = normalizeWeights(w);
        const normW = {
          wFreq: norm.wFreq,
          wInterval: norm.wInterval,
          wNeighbor: norm.wNeighbor,
          wOddEven: norm.wOddEven,
          wSize: norm.wSize,
          wHotCold: norm.wHotCold,
        };
        setWeights(normW);
        runBacktest();
        const score = evalBt();
        if (score > bestScore) {
          bestScore = score;
          best = normW;
        }
      });
    });
    setWeights(best);
    runBacktest();
  };

  const tableData = useMemo(() => {
    return bluePeriods.map((p) => ({
      key: p.期数,
      期数: p.期数,
      蓝球: p.蓝.map((n) => String(n).padStart(2, "0")).join(" "),
    }));
  }, [bluePeriods]);

  const lineData = useMemo(() => {
    return bluePeriods
      .map((p) => [
        { 期数: p.期数.substring(p.期数.length - 3), 数值: p.蓝[0], 系列: "蓝一" },
        { 期数: p.期数.substring(p.期数.length - 3), 数值: p.蓝[1], 系列: "蓝二" },
      ])
      .flat();
  }, [bluePeriods]);

  const heatData = useMemo(() => {
    const arr: any[] = [];
    bluePeriods.forEach((p) => {
      p.蓝.forEach((n) => {
        arr.push({ 期数: p.期数.substring(p.期数.length - 3), 蓝球: n, 命中: 1 });
      });
    });
    return arr;
  }, [bluePeriods]);

  const freqColumn = useMemo(() => {
    const data = nums.map((n) => ({ 数字: n, 次数: freq.raw[n] || 0 }));
    return {
      data,
      xField: "数字",
      yField: "次数",
      slider: { x: false, y: false },
      tooltip: { items: [{ name: "次数", field: "次数" }] },
    } as any;
  }, [freq]);

  const lineConfig = useMemo(() => {
    return {
      data: lineData,
      xField: "期数",
      yField: "数值",
      seriesField: "系列",
      point: { shapeField: "circle", sizeField: 3 },
      style: { lineWidth: 2 },
    } as any;
  }, [lineData]);

  const heatConfig = useMemo(() => {
    return {
      data: heatData,
      xField: "期数",
      yField: "蓝球",
      colorField: "命中",
    } as any;
  }, [heatData]);

  return (
    <div>
      <Form {...FORM_ITEM_LAYOUT}>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label={<span>窗口期<Tooltip title="用于统计的历史期数窗口，越大越平滑但可能滞后"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <InputNumber min={10} max={50} defaultValue={params.window} onChange={(v) => updateParams({ window: Number(v) })} className="w-1-1" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label={<span>围蓝集大小<Tooltip title="预测候选蓝球数量，越大覆盖面越宽但命中率可能下降"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <InputNumber min={2} max={12} defaultValue={params.candidate} onChange={(v) => updateParams({ candidate: Number(v) })} className="w-1-1" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label={<span>间隔目标<Tooltip title="目标遗漏间隔（期），实际间隔越接近得分越高"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <InputNumber min={1} max={50} defaultValue={params.intervalTarget} onChange={(v) => updateParams({ intervalTarget: Number(v) })} className="w-1-1" />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label={<span>间隔平滑<Tooltip title="对间隔差异的容忍度，数值越大评分曲线越平缓"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <InputNumber min={1} max={10} defaultValue={params.intervalSigma} onChange={(v) => updateParams({ intervalSigma: Number(v) })} className="w-1-1" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={6}>
            <Form.Item label={<span>奇偶偏好<Tooltip title="奇/偶号码权重比例，影响奇偶评分"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <Select
                defaultValue={params.oddEven}
                options={[{ value: "1:1", label: "均衡" }, { value: "2:0", label: "偏奇" }, { value: "0:2", label: "偏偶" }]}
                onChange={(v) => updateParams({ oddEven: v })}
                className="w-1-1"
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label={<span>大小偏好<Tooltip title="小号(1-6)/大号(7-12)权重比例，影响大小评分"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <Select
                defaultValue={params.size}
                options={[{ value: "1:1", label: "均衡" }, { value: "2:0", label: "偏小(1-6)" }, { value: "0:2", label: "偏大(7-12)" }]}
                onChange={(v) => updateParams({ size: v })}
                className="w-1-1"
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label={<span>冷热倾向<Tooltip title="对历史热号/冷号的偏好，影响冷热评分"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <Select
                defaultValue={params.hotCold}
                options={[{ value: "balanced", label: "均衡" }, { value: "hot", label: "偏热" }, { value: "cold", label: "偏冷" }]}
                onChange={(v) => updateParams({ hotCold: v as any })}
                className="w-1-1"
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label={<span>邻号窗口<Tooltip title="统计邻号影响的期数窗口，考虑前后相邻号码的活跃度"><QuestionCircleOutlined className="ml-4" /></Tooltip></span>}>
              <InputNumber min={3} max={10} defaultValue={params.neighborWindow} onChange={(v) => updateParams({ neighborWindow: Number(v) })} className="w-1-1" />
            </Form.Item>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={24}>
            <Space>
              <Button type="primary" onClick={predict}>计算预测</Button>
              <Tooltip title="使用当前参数在历史数据上逐期验证模型表现，统计命中率与偏差等指标">
                <Button onClick={runBacktest}>回测</Button>
              </Tooltip>
              <Tooltip title="以当前权重为基线，微调各权重并比较回测结果，自动选择回测表现更优的权重组合">
                <Button onClick={optimizeWeights}>自动优化权重</Button>
              </Tooltip>
            </Space>
          </Col>
        </Row>
      </Form>

      <Alert className="mt-24" type="info" message="提示" description="本页面基于最近50期大乐透蓝球数据进行围蓝预测与回溯验证，参数与结果将自动保存到本地存储。" />

      <Row gutter={16} className="mt-24">
        <Col span={8}><Column {...(freqColumn as any)} /></Col>
        <Col span={8}><Line {...(lineConfig as any)} /></Col>
        <Col span={8}><Heatmap {...(heatConfig as any)} /></Col>
      </Row>

      <div className="mt-24">
        <Table
          columns={[
            { title: "期数", dataIndex: "期数" },
            { title: "蓝球", dataIndex: "蓝球" },
          ]}
          dataSource={tableData}
          pagination={{ showSizeChanger: true, showQuickJumper: true, showTotal: (t) => `总计 ${t || 0} 条` }}
        />
      </div>

      {result ? (
        <div className="mt-24">
          <Alert
            type="success"
            message="预测结果"
            description={
              <div>
                <div>围蓝集合：{result.candidates.map((n) => String(n).padStart(2, "0")).join("  ")}</div>
                <div>预测蓝球：{result.pair.map((n) => String(n).padStart(2, "0")).join("  ")}</div>
              </div>
            }
          />
        </div>
      ) : null}

      {bt ? (
        <div className="mt-24">
          <Alert
            type="info"
            message="回测结果"
            description={
              <div>
                <div>样本期数：{bt.total}</div>
                <div>预测命中率(预测2球至少中1)：{((bt.hitAtLeast1 / Math.max(bt.total, 1)) * 100).toFixed(2)}%</div>
                <div>围蓝命中率(围蓝集合至少中1)：{((bt.candidateHit / Math.max(bt.total, 1)) * 100).toFixed(2)}%</div>
                <div>双蓝全中率：{((bt.hitBoth / Math.max(bt.total, 1)) * 100).toFixed(2)}%</div>
                <div>平均偏差值：{bt.avgDeviation.toFixed(2)}</div>
              </div>
            }
          />
        </div>
      ) : null}
    </div>
  );
};

export default WeilanFenxi;