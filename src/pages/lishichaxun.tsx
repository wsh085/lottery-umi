import { useState } from "react";
import { Button, Col, Form, Input, Row, Table } from "antd";
import { getAllHistoryData } from "@/utils";
import { FORM_ITEM_LAYOUT } from "@/utils/constants";
import useObjectState from "@/hooks/useObjectState";

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

  console.info("dataSource", dataSource);

  // #region 渲染DOM
  return (
    <div>
      <Form {...FORM_ITEM_LAYOUT}>
        <Row>
          <Col span={8}>
            <Form.Item label="红球" name="red">
              <Input
                className="w-1-1"
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
            <Button onClick={() => handleDataSource()}>查询</Button>
          </Col>
        </Row>
      </Form>

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
    </div>
  );
};

export default LiShiChaXun;
