export function createAnalysisRecord({method,result,tableMode='column',sourceRows=0,spec={}}={}){return{id:`analysis-${Date.now()}-${Math.random().toString(16).slice(2)}`,createdAt:new Date().toISOString(),method,tableMode,sourceRows,spec,result}}
export function addAnalysisRecord(history,record,limit=20){return[record,...history].slice(0,limit)}
