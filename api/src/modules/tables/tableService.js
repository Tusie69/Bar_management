import { validateBusinessDate, validateStatus, validateTableId } from './tableValidation.js'

export class TableService {
  constructor(repository) {
    this.repository = repository
  }

  async list(date) {
    const businessDate = validateBusinessDate(date)
    return { date: businessDate, tables: await this.repository.listByDate(businessDate) }
  }

  async updateStatus(idValue, input) {
    return this.repository.updateStatus({
      id: validateTableId(idValue),
      businessDate: validateBusinessDate(input?.date),
      status: validateStatus(input?.status),
    })
  }
}
