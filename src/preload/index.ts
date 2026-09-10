import { contextBridge } from 'electron'

// M1 占位桥：M3 起暴露数据读写 API（data:get / data:update）
contextBridge.exposeInMainWorld('qink', {
  version: '0.1.0'
})
