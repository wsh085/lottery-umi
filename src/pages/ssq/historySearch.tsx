import { useMemo, useState } from "react";
import { Alert, Button, Col, Form, Input, Row, Space, Table } from "antd";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";

import allHistoryData from "dSsq/all_history_data.json";

type HistoryItem = {
  期数: string;
  红球: string;
  蓝球: string;
  和值?: string;
  和尾?: string;
  跨度?: string;
  大小比?: string;
  奇偶比?: string;
  质合比?: string;
  "012路"?: string;
  大中小?: string;
};

type HistoryRow = HistoryItem & { 下一期?: HistoryItem };

const splitTokens = (raw?: string) => {
  return (raw || "")
    .split(/\s+/g)
    .map((s) => s.trim())
    .filter(Boolean);
};

const normalizeBall = (token: string) => {
  if (!/^\d+$/.test(token)) return token;
  return String(Number(token)).padStart(2, "0");
};

const normalizeAndValidateBalls = (
  raw: string | undefined,
  range: { min: number; max: number }
) => {
  const tokens = splitTokens(raw).map(normalizeBall);
  const uniqTokens = Array.from(new Set(tokens));
  const invalid = uniqTokens.filter((t) => {
    if (!/^\d{1,2}$/.test(t)) return true;
    const n = Number(t);
    return !Number.isFinite(n) || n < range.min || n > range.max;
  });
  return { tokens: uniqTokens, invalid };
};

const normalizeAndValidateSingleBall = (
  raw: string | undefined,
  range: { min: number; max: number }
) => {
  const tokens = splitTokens(raw).map(normalizeBall);
  const uniqTokens = Array.from(new Set(tokens));

  if (uniqTokens.length === 0) return { token: undefined, invalid: [] as string[] };
  if (uniqTokens.length > 1) return { token: undefined, invalid: uniqTokens };

  const t = uniqTokens[0];
  if (!/^\d{1,2}$/.test(t)) return { token: undefined, invalid: [t] };
  const n = Number(t);
  if (!Number.isFinite(n) || n < range.min || n > range.max)
    return { token: undefined, invalid: [t] };

  return { token: t, invalid: [] as string[] };
};

/**
 * 双色球 - 历史数据查询
 * 数据源：/dSsq/all_history_data.json
 */
const HistorySearch = () => {
  const [dataSource, setDataSource] = useState<HistoryRow[]>([]);
  const [error, setError] = useState<string>("");

  const [params, updateParams] = useObjectState<{
    qishu?: string;
    red?: string;
    blue?: string;
  }>({
    qishu: "50",
    red: undefined,
    blue: undefined,
  });

  const sortedAllHistoryData = useMemo(() => {
    return [...(allHistoryData as HistoryItem[])].sort(
      (a, b) => Number(a["期数"]) - Number(b["期数"])
    );
  }, []);

  const nextByPeriod = useMemo(() => {
    const map = new Map<string, HistoryItem>();
    sortedAllHistoryData.forEach((item, idx) => {
      const next = sortedAllHistoryData[idx + 1];
      if (next) map.set(item["期数"], next);
    });
    return map;
  }, [sortedAllHistoryData]);

  const handleQuery = () => {
    const qishu = (params.qishu || "").trim();
    let windowCount: number | undefined;
    if (qishu) {
      const limit = Number(qishu);
      if (!Number.isFinite(limit) || !Number.isInteger(limit) || limit <= 0) {
        setError("期数必须为正整数");
        return;
      }
      windowCount = Math.min(limit, sortedAllHistoryData.length);
    }

    const { tokens: redTokens, invalid: invalidRed } =
      normalizeAndValidateBalls(params.red, { min: 1, max: 33 });
    const { token: blueToken, invalid: invalidBlue } =
      normalizeAndValidateSingleBall(params.blue, { min: 1, max: 16 });

    if (invalidRed.length || invalidBlue.length) {
      const parts: string[] = [];
      if (invalidRed.length) parts.push(`红球非法输入：${invalidRed.join(" ")}`);
      if (invalidBlue.length)
        parts.push(`蓝球非法输入：${invalidBlue.join(" ")}`);
      setError(parts.join("；"));
      return;
    }

    setError("");

    const queryData =
      windowCount !== undefined
        ? sortedAllHistoryData.slice(-windowCount)
        : sortedAllHistoryData;

    const result: HistoryRow[] = [];
    queryData.forEach((item) => {
      const period = item["期数"];

      const itemRed = splitTokens(item["红球"]);
      const itemBlue = item["蓝球"];

      const redOk = redTokens.every((t) => itemRed.includes(t));
      const blueOk = blueToken ? itemBlue === blueToken : true;

      if (redOk && blueOk) {
        result.push({
          ...item,
          下一期: nextByPeriod.get(period),
        });
      }
    });

    setDataSource(result);
  };

  const chongfuNumber = useMemo(() => {
    const redCount: Record<string, number> = {};
    const blueCount: Record<string, number> = {};

    dataSource.forEach((row) => {
      const next = row["下一期"];
      if (!next) return;

      splitTokens(next["红球"]).forEach((n) => {
        redCount[n] = (redCount[n] || 0) + 1;
      });
      if (next["蓝球"]) {
        blueCount[next["蓝球"]] = (blueCount[next["蓝球"]] || 0) + 1;
      }
    });

    const red = Object.keys(redCount)
      .filter((k) => redCount[k] >= 2)
      .sort((a, b) => Number(a) - Number(b));
    const blue = Object.keys(blueCount)
      .filter((k) => blueCount[k] >= 2)
      .sort((a, b) => Number(a) - Number(b));

    return { red, redCount, blue, blueCount };
  }, [dataSource]);

  return (
    <div>
      <Form {...FORM_ITEM_LAYOUT}>
        <Row>
          <Col span={6}>
            <Form.Item label="期数" name="qishu">
              <Input
                className="w-1-1"
                allowClear
                placeholder="近 N 期（默认50，清空全量）"
                onChange={(e) => updateParams({ qishu: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="红球" name="red">
              <Input
                className="w-1-1"
                allowClear
                placeholder="红球号码，空格分隔（如：01 13 14）"
                onChange={(e) => updateParams({ red: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Form.Item label="蓝球" name="blue">
              <Input
                className="w-1-1"
                allowClear
                placeholder="请输入蓝球号码（如：09 或 9）"
                onChange={(e) => updateParams({ blue: e.target.value })}
              />
            </Form.Item>
          </Col>
          <Col span={6}>
            <Space>
              <Button className="w-1-1" onClick={handleQuery}>
                查询
              </Button>
            </Space>
          </Col>
        </Row>
      </Form>

      {error ? <Alert type="error" className="mt-16" message={error} /> : null}

      <Alert
        type="info"
        className="mt-24"
        message="说明"
        description={
          <div>
            <div>0、期数表示取历史数据末尾开始的近 N 期窗口</div>
            <div>1、红球输入为“包含”匹配：输入的每个红球都必须出现在该期红球中</div>
            <div>2、蓝球为“精确匹配”：输入蓝球时必须与该期蓝球一致</div>
            <div>
              3、下一期数据严格取自数据源中该期之后的下一条记录（按期数升序）
            </div>
          </div>
        }
      />

      <Table
        className="mt-24"
        rowKey={(r) => r["期数"]}
        columns={[
          { title: "期数", dataIndex: "期数" },
          { title: "红球", dataIndex: "红球" },
          { title: "蓝球", dataIndex: "蓝球" },
          { title: "下一期", dataIndex: ["下一期", "期数"] },
          { title: "下一期红球", dataIndex: ["下一期", "红球"] },
          { title: "下一期蓝球", dataIndex: ["下一期", "蓝球"] },
        ]}
        dataSource={dataSource}
        pagination={{
          showTotal: (total) => `总计 ${total || 0} 个项目`,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
      />

      {chongfuNumber.red.length ? (
        <div className="mt-24">
          <div>下一期红球重复出现的号码：</div>
          <div>
            {chongfuNumber.red.map((n) => {
              const count = chongfuNumber.redCount[n];
              return count > 2 ? (
                <span key={n} className="mr-8">
                  {n}(<span className="text-blue">{count}</span>)
                </span>
              ) : (
                <span key={n} className="mr-8">
                  {n}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}

      {chongfuNumber.blue.length ? (
        <div className="mt-24">
          <div>下一期蓝球重复出现的号码：</div>
          <div>
            {chongfuNumber.blue.map((n) => {
              const count = chongfuNumber.blueCount[n];
              return count > 2 ? (
                <span key={n} className="mr-8">
                  {n}(<span className="text-blue">{count}</span>)
                </span>
              ) : (
                <span key={n} className="mr-8">
                  {n}
                </span>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default HistorySearch;
