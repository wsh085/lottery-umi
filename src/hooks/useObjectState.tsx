import { useMemo, useState, useCallback } from "react";

export interface ObjectStateUtils<T> {
  /**重置对象 state，默认重置为初始值(不传参数)，也可指定重置的值	 */
  reset: (obj?: T, callback?: (currentState: T) => void) => void;
  /**删除对象属性	 */
  del: (keys: string[], callback?: (currentState: T) => void) => void;
}

/**
 * 判断函数
 * @param value
 */
function isFunction(value: any): value is (...args: any[]) => unknown {
  return typeof value === "function";
}

export interface Params<T> {
  /**
   * 初始化对象数据
   */
  initObj: T | (() => T);
}

/**
 * 返回值
 */
export type ReturnValue<T> = [
  /**
   * 当前对象数据
   */
  T,
  /**
   * 修改对象数据,属性按需修改
   */
  (
    patch: Partial<T> | ((prev: T) => Partial<T>),
    callback?: (currentState: T) => void
  ) => void,
  /**
   * 不常用方法库：reset 重置方法、del 删除方法 | ``{ del, reset }``
   */
  ObjectStateUtils<T>
];

/**
 * 对象类型状态hook，多用于对象类型的state
 * @param initObj 初始对象数据
 */
const useObjectState = <T extends Record<string, any>>(
  initObj: Params<T>["initObj"] = {} as T
): ReturnValue<T> => {
  const initState = useMemo(
    () => (isFunction(initObj) ? initObj() : initObj),
    []
  );

  const [state, setState] = useState<T>(initObj);

  /**
   * 增量更新对象
   * @param path 对象或者方法
   * @param callback 更新后的回调，参数为最新的值
   */
  const update = useCallback((patch, callback) => {
    setState((prevState) => {
      const updateState =
        typeof patch === "function" ? patch(prevState) : patch;

      const newState: T = {
        ...prevState,
        ...updateState,
      };
      callback && callback(newState);
      return newState;
    });
  }, []);

  /**
   * 重置对象
   * @param obj 指定重置对象结果，如果为空，则为初始值
   */
  const reset = (obj?: T, callback?: (currentState: T) => void) => {
    const resetState = obj ?? initState;
    setState(resetState);
    callback && callback(resetState);
  };

  /**
   * 删除对象属性
   * @param keys 要删除的属性
   */
  const del = (keys: string[], callback?: (currentState: T) => void) => {
    const deleteKeyMap: Record<string, boolean> = {};
    keys.forEach((key) => (deleteKeyMap[key] = true));
    const newState: Record<string, unknown> = {};
    let isUpdate = false;
    Object.keys(state).forEach((key) => {
      if (deleteKeyMap[key]) {
        isUpdate = true;
        return;
      }
      newState[key] = state[key];
    });
    if (isUpdate) {
      setState(newState as T);
      callback && callback(newState as T);
    }
  };

  return [state, update, { reset, del }];
};

export default useObjectState;
