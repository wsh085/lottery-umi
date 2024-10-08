import { useMemo, useState } from "react";
import { Alert, Button, Col, Form, Input, Row, Space, Table } from "antd";
import { getAllHistoryData } from "@/utils";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";
import { uniq } from "lodash-es";
import LiShiChaXunModal from "./components/LiShiChaXunModal";

/**
 * 历史数据查询
 * @returns
 */
const LiShiChaXun = () => {
  const [dataSource, setDataSource] = useState([]);

  const [params, updateParams] = useObjectState<{
    red?: string;
    blue?: string;
  }>({
    red: undefined,
    blue: undefined,
  });

  const [modalParams, updateModalParams] = useObjectState({
    open: false,
  });

  const red: string[] = params.red?.split(" ") || []; // 红球
  const blue: string[] = params.blue?.split(" ") || []; // 蓝球

  const handleDataSource = () => {
    const allHistoryData = getAllHistoryData(); // 全部历史数据

    const result: any = [];

    allHistoryData.forEach((item, index) => {
      if (
        red?.every((key) => item["红球"].includes(key)) &&
        blue?.every((key) => item["蓝球"].includes(key))
      ) {
        result.push({
          ...item,
          下一期: allHistoryData[index + 1] || {},
        });
      }
    });

    setDataSource(result);
  };

  // 计算重复出现的号码
  const chongfuNumber = useMemo(() => {
    if (dataSource.length) {
      // 重复出现的红球结果
      const redResult: string[] = [];
      // 重复出现的蓝球结果
      const blueResult: string[] = [];
      // 重复出现的红球结果的 出现次数 统计
      const redCount: any = {};
      // 重复出现的蓝球结果的 出现次数 统计
      const blueCount: any = {};
      const allRedNumber: string[] = [];
      const allBlueNumber: string[] = [];

      dataSource.forEach((item: any) => {
        // 红球
        const redqiu = item["下一期"]["红球"]?.split(" ") || [];
        // 蓝球
        const blueqiu = item["下一期"]["蓝球"]?.split(" ") || [];

        redqiu.forEach((key: string) => {
          if (allRedNumber.includes(key)) {
            redResult.push(key);
            redCount[key] = (redCount[key] || 1) + 1;
          } else {
            allRedNumber.push(key);
          }
        });

        blueqiu.forEach((key: string) => {
          if (allBlueNumber.includes(key)) {
            blueResult.push(key);
            blueCount[key] = (blueCount[key] || 1) + 1;
          } else {
            allBlueNumber.push(key);
          }
        });
      });

      return {
        red: uniq(redResult.sort((a, b) => Number(a) - Number(b))),
        redCount,
        blue: uniq(blueResult.sort((a, b) => Number(a) - Number(b))),
        blueCount,
      };
    }
    return {
      red: [],
      blue: [],
    };
  }, [dataSource]);

  // #region 渲染DOM
  return (
    <div>
      <Form {...FORM_ITEM_LAYOUT}>
        <Row>
          <Col span={8}>
            <Form.Item label="红球" name="red">
              <Input
                className="w-1-1"
                allowClear
                placeholder="请输入红球号码，空格分隔"
                onChange={(e) =>
                  updateParams({
                    red: e.target.value,
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Form.Item label="蓝球" name="blue">
              <Input
                className="w-1-1"
                allowClear
                placeholder="请输入蓝球号码，空格分隔"
                onChange={(e) =>
                  updateParams({
                    blue: e.target.value,
                  })
                }
              />
            </Form.Item>
          </Col>
          <Col span={8}>
            <Space>
              <Button className="w-1-1" onClick={() => handleDataSource()}>
                查询
              </Button>
              <Button
                className="w-1-1"
                onClick={() => updateModalParams({ open: true })}
              >
                方法验证
              </Button>
            </Space>
          </Col>
        </Row>
      </Form>

      <Alert
        type="info"
        className="mt-24"
        message="查询方法"
        closable
        description={
          <div>
            <div>1、取红球的前三个号码 进行查询</div>
            <div>2、取红球的中间三个号码 进行查询</div>
            <div>3、取红球的后2个号码 + 蓝球第1个号码 进行查询</div>
            <div>
              4、取红球的第3、第4号码 + 蓝球第1个号码/第2个号码/全部号码
              进行查询
            </div>
          </div>
        }
      />

      <Table
        className="mt-24"
        columns={[
          {
            title: "期数",
            dataIndex: "期数",
            render: (t) => t,
          },
          {
            title: "红球",
            dataIndex: "红球",
            render: (t) => t,
          },
          {
            title: "蓝球",
            dataIndex: "蓝球",
            render: (t) => t,
          },
          {
            title: "下一期",
            dataIndex: ["下一期", "期数"],
            render: (t) => t,
          },
          {
            title: "下一期红球",
            dataIndex: ["下一期", "红球"],
            render: (t) => t,
          },
          {
            title: "下一期蓝球",
            dataIndex: ["下一期", "蓝球"],
            render: (t) => t,
          },
        ]}
        dataSource={dataSource}
        pagination={{
          showTotal: (total) => `总计 ${total || 0} 个项目`,
          showSizeChanger: true,
          showQuickJumper: true,
        }}
      />
      {
        // 红球重复号码
        chongfuNumber.red?.length ? (
          <div className="mt-24">
            <div>红球重复出现的号码：</div>
            <div>
              {chongfuNumber.red?.map((number) => {
                if (chongfuNumber.redCount[number] > 2) {
                  return (
                    <span className="mr-8">
                      {number}(
                      <span className="text-blue">
                        {chongfuNumber.redCount[number]}
                      </span>
                      )
                    </span>
                  );
                }
                return <span className="mr-8">{number}</span>;
              })}
            </div>
          </div>
        ) : null
      }
      {
        // 蓝球重复号码
        chongfuNumber.blue?.length ? (
          <div className="mt-24">
            <div>蓝球重复出现的号码：</div>
            <div>
              {chongfuNumber.blue?.map((number) => {
                if (chongfuNumber.blueCount[number] > 2) {
                  return (
                    <span className="mr-8">
                      {number}(
                      <span className="text-blue">
                        {chongfuNumber.blueCount[number]}
                      </span>
                      )
                    </span>
                  );
                }
                return <span className="mr-8">{number}</span>;
              })}
            </div>
          </div>
        ) : null
      }
      <LiShiChaXunModal
        open={modalParams.open}
        // handleShaHao={handleShaHao}
        onOk={() => updateModalParams({ open: false })}
        onCancel={() => updateModalParams({ open: false })}
      />
    </div>
  );
};

export default LiShiChaXun;
